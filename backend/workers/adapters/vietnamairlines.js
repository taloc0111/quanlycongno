// workers/adapters/vietnamairlines.js — Vietnam Airlines (VN).
// KHÔNG scrape DOM — gọi thẳng API public của middleware VNA (đứng sau widget
// "Mua vé" trang chủ, dò ra 2026-06 bằng probe-vn.js):
//   POST https://integration-middleware-website.vietnamairlines.com
//        /api/v1/public/booking/air-best-price
//   body: { route: { originLocationCode, destinationLocationCode,
//                    departureDateTime: 'yyyy-mm-dd' },           ← neo cửa sổ ngày
//           tripDetails: { rangeOfDeparture: <số ngày> },         ← BỎ tripDuration = giá MỘT CHIỀU
//           location: 'VN' }
//   → data.prices[]: { departureDate, price: [{ base, total, totalTaxes, currencyCode }] }
//   total = giá 1 người lớn đã gồm thuế phí. Không cần auth, không anti-bot.
// Ưu điểm: không cần Chromium → chạy được cả trên web service RAM thấp.
//
// TLS: server VNA gửi THIẾU chứng chỉ trung gian (chỉ gửi leaf ×2) → Node lỗi
// UNABLE_TO_VERIFY_LEAF_SIGNATURE dù browser vẫn vào được. Vá bằng cách nhúng
// intermediate "GlobalSign RSA OV SSL CA 2018" (công khai, hết hạn 2028-11-21)
// vào danh sách CA. Khi VNA đổi nhà phát hành cert → tải intermediate mới thay vào.
const https = require('https');
const tls = require('tls');
const { parseRoute, parseDate, minPrice } = require('../lib/util');

// GlobalSign RSA OV SSL CA 2018 — intermediate ký cert *.vietnamairlines.com.
const GLOBALSIGN_RSA_OV_2018 = `-----BEGIN CERTIFICATE-----
MIIETjCCAzagAwIBAgINAe5fIh38YjvUMzqFVzANBgkqhkiG9w0BAQsFADBMMSAw
HgYDVQQLExdHbG9iYWxTaWduIFJvb3QgQ0EgLSBSMzETMBEGA1UEChMKR2xvYmFs
U2lnbjETMBEGA1UEAxMKR2xvYmFsU2lnbjAeFw0xODExMjEwMDAwMDBaFw0yODEx
MjEwMDAwMDBaMFAxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52
LXNhMSYwJAYDVQQDEx1HbG9iYWxTaWduIFJTQSBPViBTU0wgQ0EgMjAxODCCASIw
DQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKdaydUMGCEAI9WXD+uu3Vxoa2uP
UGATeoHLl+6OimGUSyZ59gSnKvuk2la77qCk8HuKf1UfR5NhDW5xUTolJAgvjOH3
idaSz6+zpz8w7bXfIa7+9UQX/dhj2S/TgVprX9NHsKzyqzskeU8fxy7quRU6fBhM
abO1IFkJXinDY+YuRluqlJBJDrnw9UqhCS98NE3QvADFBlV5Bs6i0BDxSEPouVq1
lVW9MdIbPYa+oewNEtssmSStR8JvA+Z6cLVwzM0nLKWMjsIYPJLJLnNvBhBWk0Cq
o8VS++XFBdZpaFwGue5RieGKDkFNm5KQConpFmvv73W+eka440eKHRwup08CAwEA
AaOCASkwggElMA4GA1UdDwEB/wQEAwIBhjASBgNVHRMBAf8ECDAGAQH/AgEAMB0G
A1UdDgQWBBT473/yzXhnqN5vjySNiPGHAwKz6zAfBgNVHSMEGDAWgBSP8Et/qC5F
JK5NUPpjmove4t0bvDA+BggrBgEFBQcBAQQyMDAwLgYIKwYBBQUHMAGGImh0dHA6
Ly9vY3NwMi5nbG9iYWxzaWduLmNvbS9yb290cjMwNgYDVR0fBC8wLTAroCmgJ4Yl
aHR0cDovL2NybC5nbG9iYWxzaWduLmNvbS9yb290LXIzLmNybDBHBgNVHSAEQDA+
MDwGBFUdIAAwNDAyBggrBgEFBQcCARYmaHR0cHM6Ly93d3cuZ2xvYmFsc2lnbi5j
b20vcmVwb3NpdG9yeS8wDQYJKoZIhvcNAQELBQADggEBAJmQyC1fQorUC2bbmANz
EdSIhlIoU4r7rd/9c446ZwTbw1MUcBQJfMPg+NccmBqixD7b6QDjynCy8SIwIVbb
0615XoFYC20UgDX1b10d65pHBf9ZjQCxQNqQmJYaumxtf4z1s4DfjGRzNpZ5eWl0
6r/4ngGPoJVpjemEuunl1Ig423g7mNA2eymw0lIYkN5SQwCuaifIFJ6GlazhgDEw
fpolu4usBCOmmQDo8dIm7A9+O4orkjgTHY+GzYZSR+Y0fFukAj6KYXwidlNalFMz
hriSqHKvoflShx8xpfywgVcvzfTO3PYkz6fiNJBonf6q8amaEsybwMbDqKWwIX7e
SPY=
-----END CERTIFICATE-----`;

const API_HOST = 'integration-middleware-website.vietnamairlines.com';
const API_PATH = '/api/v1/public/booking/air-best-price';
const TIMEOUT_MS = 30000;

// Agent dùng chung: root mặc định của Node + intermediate bị VNA bỏ quên.
const agent = new https.Agent({ ca: [...tls.rootCertificates, GLOBALSIGN_RSA_OV_2018] });

function postBestPrice(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: API_HOST,
      path: API_PATH,
      method: 'POST',
      agent,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Origin': 'https://www.vietnamairlines.com',
        'Referer': 'https://www.vietnamairlines.com/',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        'Content-Length': Buffer.byteLength(data),
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode === 400) {
          // API trả 400 khi ngày nằm ngoài lịch mở bán (~330 ngày) hoặc chặng không khai thác.
          return reject(new Error('Vietnam Airlines từ chối yêu cầu (ngày ngoài lịch mở bán hoặc chặng không khai thác)'));
        }
        if (res.statusCode !== 200) return reject(new Error(`VNA air-best-price trả HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(buf)); } catch { reject(new Error('VNA air-best-price trả JSON không hợp lệ')); }
      });
    });
    req.on('error', (e) => {
      if (/UNABLE_TO_VERIFY|CERT/i.test(e.message)) {
        reject(new Error('TLS Vietnam Airlines đổi chứng chỉ — cần thay intermediate CA trong adapter (xem chú thích đầu file)'));
      } else reject(e);
    });
    req.on('timeout', () => req.destroy(new Error('VNA air-best-price quá thời gian chờ')));
    req.write(data);
    req.end();
  });
}

module.exports = {
  key: 'vn',
  label: 'Vietnam Airlines',
  // ctx (Playwright) nhận nhưng KHÔNG dùng — adapter này đi đường HTTP thuần.
  async getLowestFare({ route, date, ctx, log = () => {} }) {
    const r = parseRoute(route);
    const d = parseDate(date);
    if (!r || !d) throw new Error(`Hành trình/ngày không hợp lệ: route=${route} date=${date}`);

    log(`vn: POST ${API_HOST}${API_PATH} ${r.origin}-${r.dest} ${d.iso} (một chiều)`);
    const json = await postBestPrice({
      route: { originLocationCode: r.origin, destinationLocationCode: r.dest, departureDateTime: d.iso },
      tripDetails: { rangeOfDeparture: 3 }, // không tripDuration → giá một chiều; cửa sổ nhỏ quanh ngày đích
      location: 'VN',
    });

    const entries = json?.data?.prices || [];
    const hit = entries.find((p) => p.departureDate === d.iso);
    if (!hit) {
      // API chỉ trả các ngày còn chỗ — không có ngày đích nghĩa là hết vé/ngoài lịch mở bán.
      throw new Error(`Vietnam Airlines không có giá cho ${r.origin}-${r.dest} ngày ${d.iso} (hết chỗ hoặc ngoài lịch mở bán)`);
    }
    const totals = (hit.price || []).map((p) => parseInt(p.total, 10)).filter((n) => Number.isFinite(n) && n > 0);
    const price = minPrice(totals);
    if (!price) throw new Error('Vietnam Airlines trả dữ liệu giá rỗng/không đọc được');

    return { price, currency: hit.price?.[0]?.currencyCode || 'VND', source: 'vn', flightNo: null, departTime: null };
  },
};
