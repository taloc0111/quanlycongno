// utils/services.js — cấu hình chung cho 4 loại dịch vụ (vé máy bay / hộ chiếu / vé tàu / tour)
// dùng ở thanh toán, phiếu thu, huỷ/hoàn, công nợ theo khách (Dòng tiền v3.1, docs/MONEY-FLOWS.md).
// Tên bảng/cột ở đây là whitelist — được ghép thẳng vào SQL.
const v = require('./validate');

/**
 * type → bảng + cột. `price` = giá bán, `paid` = cột đã trả (tính lại từ payments),
 * `payCol` = cột khoá ngoại trên payments/cost_items, `date` = ngày giao dịch,
 * `cancelled` = điều kiện SQL "đã huỷ" (alias x), `activeStatus` = trạng thái khi hoàn tác huỷ.
 */
const SERVICES = {
  debt: {
    table: 'debts', price: 'ticket_amount', paid: 'paid', payCol: 'debt_id', date: 'issue_date',
    entity: 'debt', bodyKey: 'debtId', activeStatus: 'active', name: 'Vé máy bay',
  },
  passport: {
    table: 'passports', price: 'total_amount', paid: 'paid_amount', payCol: 'passport_id', date: 'service_date',
    entity: 'passport', bodyKey: 'passportId', activeStatus: 'active', name: 'Hộ chiếu',
  },
  train: {
    table: 'train_tickets', price: 'ticket_amount', paid: 'paid', payCol: 'train_ticket_id', date: 'issue_date',
    entity: 'train_ticket', bodyKey: 'trainTicketId', activeStatus: 'active', name: 'Vé tàu',
  },
  tour: {
    table: 'tours', price: 'sell_amount', paid: 'paid', payCol: 'tour_id', date: 'issue_date',
    entity: 'tour', bodyKey: 'tourId', activeStatus: 'deposited', name: 'Tour',
  },
};

const TYPES = Object.keys(SERVICES);

function service(type) {
  const s = SERVICES[type];
  if (!s) throw new Error(`services: loại dịch vụ không hợp lệ: ${type}`);
  return s;
}

/** Nhãn ngắn của 1 dòng dịch vụ (alias x) — "Vé VN123 HAN-SGN", "Hộ chiếu P1", "Vé tàu SE7 HN-Vinh", "Tour Sapa". */
function labelSql(type, x = 'x') {
  switch (type) {
    case 'debt': return `concat_ws(' ', 'Vé', NULLIF(${x}.ticket_code, ''), NULLIF(${x}.route, ''))`;
    case 'passport': return `concat_ws(' ', 'Hộ chiếu', NULLIF(${x}.passport_number, ''))`;
    case 'train': return `concat_ws(' ', 'Vé tàu', NULLIF(${x}.train_no, ''), NULLIF(${x}.route, ''))`;
    case 'tour': return `concat_ws(' ', 'Tour', NULLIF(${x}.tour_name, ''))`;
    default: throw new Error(`services: loại dịch vụ không hợp lệ: ${type}`);
  }
}

/** Điều kiện SQL "dịch vụ đã huỷ" (cả 4 bảng đều có cột status sau v3.1). */
const cancelledSql = (x = 'x') => `${x}.status = 'cancelled'`;

/** Tính lại cột đã trả của 1 dịch vụ = SUM(payments) (dòng hoàn âm tự trừ). */
async function recomputeServicePaid(client, type, id) {
  if (!id) return;
  const s = service(type);
  await client.query(
    `UPDATE ${s.table} SET ${s.paid} = COALESCE((SELECT SUM(amount) FROM payments WHERE ${s.payCol} = $1), 0)
      WHERE id = $1`,
    [id]
  );
}

/** Loại dịch vụ của 1 dòng payments/cost_items theo cột *_id có giá trị. */
function typeOfRow(row) {
  for (const t of TYPES) if (row[SERVICES[t].payCol]) return t;
  return null;
}

/**
 * Khoá + đọc 1 dịch vụ của chính user (FOR UPDATE). Trả null nếu không có / không phải của mình.
 * Kết quả có thêm `total`, `paid_total`, `remaining`, `label`, `is_cancelled`.
 */
async function lockService(client, type, id, userId) {
  const s = service(type);
  const r = await client.query(
    `SELECT x.*, x.${s.price} AS total, x.${s.paid} AS paid_total, x.${s.price} - x.${s.paid} AS remaining,
            ${labelSql(type, 'x')} AS label, (${cancelledSql('x')}) AS is_cancelled
       FROM ${s.table} x WHERE x.id = $1 AND x.user_id = $2 FOR UPDATE`,
    [id, userId]
  );
  return r.rows[0] || null;
}

/**
 * Chặn xoá dịch vụ đã huỷ có dòng hoàn tiền khách (kind refund): xoá sẽ làm mất/âm tiền hoàn
 * trong ví hoặc lệch sổ tài khoản → phải "Hoàn tác huỷ" trước. Ném ValidationError (→ 400).
 */
async function assertNoRefunds(client, type, ids, userId) {
  const s = service(type);
  const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isInteger);
  if (list.length === 0) return;
  const r = await client.query(
    `SELECT 1 FROM payments WHERE ${s.payCol} = ANY($1::int[]) AND user_id = $2 AND kind = 'refund' LIMIT 1`,
    [list, userId]
  );
  if (r.rows.length > 0) {
    throw new v.ValidationError('Dịch vụ đã huỷ và đã hoàn tiền khách — hãy "Hoàn tác huỷ" trước khi xoá');
  }
}

/** Làm tròn tiền 2 chữ số (tránh sai số dấu phẩy động khi so sánh). */
const round2 = (x) => Math.round(Number(x) * 100) / 100;

module.exports = {
  SERVICES,
  TYPES,
  service,
  labelSql,
  cancelledSql,
  recomputeServicePaid,
  typeOfRow,
  lockService,
  assertNoRefunds,
  round2,
};
