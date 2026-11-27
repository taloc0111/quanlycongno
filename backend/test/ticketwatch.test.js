// test/ticketwatch.test.js — canh vé: update từng phần, rate-limit check-now, fareWatcher unit.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const fw = require('../workers/fareWatcher');
const { todayLocal, addDays } = require('../utils/dates');

let U;
before(async () => {
  await h.start();
  U = await h.seedUsers();
});
after(() => h.stop());

test("updateWatch: {status} giữ nguyên route/ngày; '' xoá field nullable; sai status → 400", async () => {
  const api = h.api(U.admin.token);
  const dep = addDays(todayLocal(), 30);
  const c = await api.post('/api/ticket-watches', {
    customerName: 'Khách A', route: 'SGN-HAN', departDate: dep, returnDate: '', airline: 'VietJet',
    pax: 2, targetPrice: 1500000, notes: 'ghi chú', autoTrack: true,
  });
  assert.equal(c.status, 201);
  assert.equal(c.body.depart_date, dep, 'DATE trả về chuỗi yyyy-mm-dd');
  assert.equal(c.body.return_date, null);
  assert.equal(c.body.auto_track, true);

  // nút trạng thái chỉ gửi {status}
  let r = await api.put(`/api/ticket-watches/${c.body.id}`, { status: 'quoted' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'quoted');
  assert.equal(r.body.route, 'SGN-HAN');
  assert.equal(r.body.depart_date, dep);
  assert.equal(r.body.airline, 'VietJet');
  assert.equal(r.body.pax, 2);
  assert.equal(Number(r.body.target_price), 1500000);
  assert.equal(r.body.notes, 'ghi chú');
  assert.equal(r.body.auto_track, true);

  // gửi '' → NULL; gửi null → NULL
  r = await api.put(`/api/ticket-watches/${c.body.id}`, { notes: '', airline: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.notes, null);
  assert.equal(r.body.airline, null);
  assert.equal(r.body.route, 'SGN-HAN');

  // sai dữ liệu
  assert.equal((await api.put(`/api/ticket-watches/${c.body.id}`, { status: 'bogus' })).status, 400);
  assert.equal((await api.put(`/api/ticket-watches/${c.body.id}`, { customerName: '' })).status, 400);
  assert.equal((await api.put(`/api/ticket-watches/${c.body.id}`, { departDate: '31/12/2026' })).status, 400);
  assert.equal((await api.put(`/api/ticket-watches/${c.body.id}`, {})).status, 400);
  assert.equal((await api.put('/api/ticket-watches/abc', { status: 'booked' })).status, 400);
  assert.equal((await api.put('/api/ticket-watches/99999', { status: 'booked' })).status, 404);
  // user khác không thấy
  await h.api(U.admin.token).put(`/api/users/${U.other.id}/features`, { fareWatch: true });
  assert.equal((await h.api(U.other.token).put(`/api/ticket-watches/${c.body.id}`, { status: 'booked' })).status, 404);
});

test('check-now: rate-limit 3/phút/user → lần 4 trả 429', async () => {
  const api = h.api(U.admin.token);
  const c = await api.post('/api/ticket-watches', {
    customerName: 'Khách B', route: 'SGN-HAN', departDate: addDays(todayLocal(), 20), airline: 'VietJet',
  });
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await api.post(`/api/ticket-watches/${c.body.id}/check-now`)).status);
  assert.deepEqual(statuses.slice(0, 3), [200, 200, 200]);
  assert.equal(statuses[3], 429);
  // snapshot được ghi (ok=false vì không có nguồn giá trong test)
  const snaps = await api.get(`/api/ticket-watches/${c.body.id}/snapshots`);
  assert.equal(snaps.status, 200);
  assert.equal(snaps.body.length, 3);
  assert.equal(snaps.body[0].ok, false);
  // user khác không bị ảnh hưởng bởi limiter của admin
  const o = await h.api(U.other.token).post('/api/ticket-watches', { customerName: 'X', route: 'HAN-SGN', departDate: addDays(todayLocal(), 20), airline: 'VietJet' });
  assert.equal((await h.api(U.other.token).post(`/api/ticket-watches/${o.body.id}/check-now`)).status, 200);
});

test('fareWatcher: parseIntervalMin / parseCooldownH kẹp giá trị', () => {
  assert.equal(fw.parseIntervalMin(undefined), 60);
  assert.equal(fw.parseIntervalMin(''), 60);
  assert.equal(fw.parseIntervalMin('abc'), 60);
  assert.equal(fw.parseIntervalMin('0'), 1);
  assert.equal(fw.parseIntervalMin('-5'), 1);
  assert.equal(fw.parseIntervalMin('2.7'), 2);
  assert.equal(fw.parseIntervalMin('15'), 15);
  assert.equal(fw.parseCooldownH(undefined), 12);
  assert.equal(fw.parseCooldownH('NaN'), 12);
  assert.equal(fw.parseCooldownH('-1'), 0);
  assert.equal(fw.parseCooldownH('0.5'), 0.5);
});

test('fareWatcher.runOnce: vòng chồng bị bỏ qua (inFlight), lỗi 1 watch không hỏng vòng', async () => {
  const dep = addDays(todayLocal(), 10);
  await h.pool.query('UPDATE ticket_watches SET auto_track = FALSE'); // chỉ 2 watch dưới đây được canh
  await h.pool.query(
    `INSERT INTO ticket_watches (user_id, customer_name, route, depart_date, airline, auto_track)
     VALUES ($1,'W1','SGN-HAN',$2,'VietJet',TRUE), ($1,'W2','SGN-DAD',$2,'VietJet',TRUE)`,
    [U.admin.id, dep]
  );
  const logs = [];
  const log = (m) => logs.push(m);
  let calls = 0;
  const slowCheck = async (w) => {
    calls++;
    await new Promise((r) => setTimeout(r, 60));
    if (w.customer_name === 'W1') throw new Error('bùm');
    return { ok: true, price: 1000, airline: 'VJ' };
  };
  const p1 = fw.runOnce({ log, check: slowCheck });
  const p2 = fw.runOnce({ log, check: slowCheck });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r2.skipped, true, 'vòng 2 bị bỏ qua');
  assert.equal(r1.checked, 2);
  assert.equal(r1.ok, 1);
  assert.equal(r1.fail, 1, 'watch lỗi tính là fail, vòng vẫn xong');
  assert.equal(calls, 2);
  assert.ok(logs.some((m) => m.includes('bỏ qua')));
  // sau khi xong, chạy lại được
  const r3 = await fw.runOnce({ log, check: async () => ({ ok: false, error: 'x' }) });
  assert.equal(r3.checked, 2);
});
