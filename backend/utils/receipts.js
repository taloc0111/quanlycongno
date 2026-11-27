// utils/receipts.js — Phiếu thu (Dòng tiền v3.1): 1 lần khách chuyển tiền chia cho nhiều dịch vụ,
// phần thừa vào ví khách (wallet_entries topup gắn receipt_id). Dùng chung cho POST /api/receipts
// và "trả thừa" của POST /api/payments. Gọi TRONG transaction.
const v = require('./validate');
const { assertOwns } = require('./ownership');
const { assertAccount } = require('./costItems');
const { lockWallet, fmtVnd } = require('./money');
const { service, lockService, recomputeServicePaid, round2, TYPES } = require('./services');

const MAX_ALLOCATIONS = 100;

/**
 * Đọc + kiểm tra mảng allocations [{ type, id, amount>0 }]. Ném ValidationError khi sai.
 * @returns {Array<{type:string, id:number, amount:number}>}
 */
function parseAllocations(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new v.ValidationError('Danh sách phân bổ không hợp lệ');
  if (raw.length > MAX_ALLOCATIONS) throw new v.ValidationError(`Tối đa ${MAX_ALLOCATIONS} dịch vụ mỗi phiếu thu`);
  const seen = new Set();
  return raw.map((a, i) => {
    const p = `Phân bổ ${i + 1}`;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new v.ValidationError(`${p} không hợp lệ`);
    const type = v.oneOf(a.type, TYPES, { required: true, label: `${p}: loại dịch vụ` });
    const id = v.int(a.id, { min: 1, required: true, label: `${p}: mã dịch vụ` });
    const amount = v.num(a.amount, { required: true, label: `${p}: số tiền` });
    if (amount <= 0) throw new v.ValidationError(`${p}: số tiền phải lớn hơn 0`);
    const key = `${type}:${id}`;
    if (seen.has(key)) throw new v.ValidationError(`${p}: trùng dịch vụ`);
    seen.add(key);
    return { type, id, amount: round2(amount) };
  });
}

/**
 * Tạo phiếu thu + payments con + nạp ví phần thừa, tính lại cột đã trả.
 * @param {import('pg').PoolClient} client  đang trong transaction
 * @param {number} userId
 * @param {{customerId:number|null, accountId:number|null, amount:number, receiptDate:string, method:string|null,
 *          paymentTarget:string, notes:string|null, allocations:Array<{type,id,amount}>}} r
 * @returns {Promise<{receipt:object, payments:object[], walletTopup:object|null, services:object[]}>}
 */
async function createReceipt(client, userId, r) {
  const amount = round2(r.amount);
  await assertAccount(client, r.accountId, userId);
  if (r.customerId !== null && r.customerId !== undefined && !(await assertOwns(client, 'customers', r.customerId, userId))) {
    throw new v.ValidationError('Khách hàng không hợp lệ');
  }
  const allocated = round2(r.allocations.reduce((s, a) => s + a.amount, 0));
  if (allocated > amount) {
    throw new v.ValidationError(`Tổng phân bổ ${fmtVnd(allocated)} vượt số tiền phiếu thu ${fmtVnd(amount)}`);
  }

  // Khoá các dịch vụ theo thứ tự cố định (tránh deadlock), kiểm tra quyền / huỷ / số còn nợ.
  const ordered = [...r.allocations].sort((a, b) => (a.type === b.type ? a.id - b.id : a.type < b.type ? -1 : 1));
  const services = [];
  for (const a of ordered) {
    const row = await lockService(client, a.type, a.id, userId);
    if (!row) throw new v.ValidationError('Dịch vụ không hợp lệ');
    // Dịch vụ đã huỷ vẫn thu được phần phí huỷ khách còn nợ (kiểm bằng "số còn nợ" ngay dưới).
    if (row.is_cancelled && !(round2(row.remaining) > 0)) throw new v.ValidationError(`${row.label || service(a.type).name}: dịch vụ đã huỷ và khách không còn nợ`);
    if (a.amount > round2(row.remaining)) {
      throw new v.ValidationError(`${row.label || service(a.type).name}: số chia ${fmtVnd(a.amount)} vượt số còn nợ (còn ${fmtVnd(Math.max(0, Number(row.remaining)))})`);
    }
    services.push({ ...a, row });
  }

  const remainder = round2(amount - allocated);
  if (remainder > 0 && (r.customerId === null || r.customerId === undefined)) {
    throw new v.ValidationError('Có phần tiền thừa vào ví — cần chọn khách hàng');
  }

  const ins = await client.query(
    `INSERT INTO receipts (user_id, customer_id, account_id, amount, receipt_date, method, payment_target, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [userId, r.customerId ?? null, r.accountId ?? null, amount, r.receiptDate, r.method, r.paymentTarget, r.notes]
  );
  const receipt = ins.rows[0];

  // payments con theo đúng thứ tự gửi lên.
  const payments = [];
  for (const a of r.allocations) {
    const s = service(a.type);
    const p = await client.query(
      `INSERT INTO payments (user_id, ${s.payCol}, amount, payment_date, method, notes, payment_target, account_id, receipt_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [userId, a.id, a.amount, r.receiptDate, r.method, r.notes, r.paymentTarget, r.accountId ?? null, receipt.id]
    );
    payments.push(p.rows[0]);
  }

  let walletTopup = null;
  if (remainder > 0) {
    await lockWallet(client, r.customerId);
    const w = await client.query(
      `INSERT INTO wallet_entries (user_id, customer_id, kind, amount, entry_date, account_id, receipt_id, notes)
       VALUES ($1,$2,'topup',$3,$4,$5,$6,$7) RETURNING *`,
      [userId, r.customerId, remainder, r.receiptDate, r.accountId ?? null, receipt.id, r.notes || 'Tiền thừa từ phiếu thu']
    );
    walletTopup = w.rows[0];
  }

  for (const a of r.allocations) await recomputeServicePaid(client, a.type, a.id);
  return { receipt, payments, walletTopup, services };
}

module.exports = { parseAllocations, createReceipt, MAX_ALLOCATIONS };
