// test/money-accounts.test.js — Dòng tiền v3: schema idempotent + không mất dữ liệu cũ,
// tài khoản tiền (CRUD, số dư, sổ chi tiết, đối soát, phạm vi đại lý, id ngoại).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const h = require('./helpers');

let U;
let api;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
});
after(() => h.stop());

const N = (x) => Number(x);

test('schema chạy lại 2 lần không lỗi; dòng cũ giữ nguyên cost_amount=123 kể cả sau khi sửa không gửi costItems', async () => {
  const ins = await h.pool.query(
    `INSERT INTO debts (user_id, customer_name, phone_number, ticket_amount, cost_amount, paid, issue_date)
     VALUES ($1, 'Khách cũ', '0900', 500000, 123, 0, '2026-10-01') RETURNING id`,
    [U.child.id]
  );
  const id = ins.rows[0].id;
  const pass = await h.pool.query(
    `INSERT INTO passports (user_id, customer_name, service_date, total_amount, cost_amount)
     VALUES ($1, 'HC cũ', '2026-10-01', 900000, 456) RETURNING id`,
    [U.child.id]
  );

  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema', 'schema.sql'), 'utf8');
  await h.pool.query(sql);
  await h.pool.query(sql); // idempotent: chạy lần 2 vẫn OK

  let r = await h.pool.query('SELECT cost_amount, cost_pending, ticket_kind FROM debts WHERE id = $1', [id]);
  assert.equal(N(r.rows[0].cost_amount), 123);
  assert.equal(r.rows[0].cost_pending, false);
  assert.equal(r.rows[0].ticket_kind, 'normal');
  r = await h.pool.query('SELECT cost_amount, cost_pending FROM passports WHERE id = $1', [pass.rows[0].id]);
  assert.equal(N(r.rows[0].cost_amount), 456);

  // v3.1: dòng cũ nhận mặc định trạng thái 'active', chưa có giá gốc/ngày huỷ; bảng mới có đủ.
  r = await h.pool.query('SELECT status, original_amount, cancelled_at, cancel_note, ticket_amount FROM debts WHERE id = $1', [id]);
  assert.deepEqual(r.rows[0], { status: 'active', original_amount: null, cancelled_at: null, cancel_note: null, ticket_amount: '500000.00' });
  r = await h.pool.query('SELECT status FROM passports WHERE id = $1', [pass.rows[0].id]);
  assert.equal(r.rows[0].status, 'active');
  const tables = (await h.pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_name IN ('account_transfers','account_entries','receipts') ORDER BY 1"
  )).rows.map((x) => x.table_name);
  assert.deepEqual(tables, ['account_entries', 'account_transfers', 'receipts']);
  const cols = (await h.pool.query(
    `SELECT table_name || '.' || column_name AS c, column_default FROM information_schema.columns
      WHERE (table_name, column_name) IN (('payments','kind'),('payments','receipt_id'),('wallet_entries','receipt_id'),('cost_items','kind'),
                                          ('train_tickets','status'),('tours','original_amount'))
      ORDER BY 1`
  )).rows.map((x) => x.c);
  assert.deepEqual(cols, ['cost_items.kind', 'payments.kind', 'payments.receipt_id', 'tours.original_amount', 'train_tickets.status', 'wallet_entries.receipt_id']);
  // supplier_payments: ràng buộc mới amount <> 0 (âm = NCC trả lại), chỉ 1 ràng buộc amount sau 2 lần chạy.
  const cons = (await h.pool.query(
    `SELECT conname FROM pg_constraint WHERE conrelid = 'supplier_payments'::regclass AND contype = 'c' ORDER BY 1`
  )).rows.map((x) => x.conname);
  assert.deepEqual(cons, ['chk_supplier_payment_amount']);
  const sup = await h.pool.query("INSERT INTO suppliers (user_id, name) VALUES ($1, 'NCC schema') RETURNING id", [U.child.id]);
  await h.pool.query('INSERT INTO supplier_payments (user_id, supplier_id, amount) VALUES ($1, $2, -1000)', [U.child.id, sup.rows[0].id]);
  await assert.rejects(h.pool.query('INSERT INTO supplier_payments (user_id, supplier_id, amount) VALUES ($1, $2, 0)', [U.child.id, sup.rows[0].id]));
  await h.pool.query('DELETE FROM suppliers WHERE id = $1', [sup.rows[0].id]);
  await h.pool.query(sql); // lần 3 sau khi có dữ liệu âm vẫn OK

  // Sửa KHÔNG gửi costItems và KHÔNG gửi costAmount → giữ 123.
  let u = await api.put(`/api/debts/${id}`, { customerName: 'Khách cũ', phoneNumber: '0900', ticketAmount: 500000, issueDate: '2026-10-01', notes: 'sửa' });
  assert.equal(u.status, 200);
  assert.equal(N(u.body.cost_amount), 123);
  assert.deepEqual(u.body.cost_items, []);
  // Sửa gửi costAmount như FE cũ, không costItems → 123.
  u = await api.put(`/api/debts/${id}`, { customerName: 'Khách cũ', phoneNumber: '0900', ticketAmount: 500000, costAmount: 123, issueDate: '2026-10-01' });
  assert.equal(N(u.body.cost_amount), 123);
  assert.equal(u.body.cost_pending, false, 'không gửi costPending → giữ nguyên');
  assert.equal(u.body.ticket_kind, 'normal');

  const list = await api.get('/api/debts');
  const row = list.body.find((d) => d.id === id);
  assert.deepEqual(row.cost_items, []);
  assert.equal(N(row.cost_unpaid), 0);
  assert.equal(row.cost_pending, false);
  assert.equal(row.ticket_kind, 'normal');
  assert.equal(N(row.cost_amount), 123);
  // Payments cũ (không account) vẫn đọc được với cột mới
  const p = await api.post('/api/payments', { debtId: id, amount: 1000 });
  assert.equal(p.status, 201);
  assert.equal(p.body.account_id, null);
  assert.equal(p.body.reconciled, false);
});

test('tạo hộ chiếu / tour / vé tàu kèm accountId → payment đầu gắn tài khoản, số dư TK tính vào; accountId null = không TK', async () => {
  const acc = (await api.post('/api/accounts', { name: 'TK tạo dịch vụ', openingBalance: 0 })).body;
  const ps = await api.post('/api/passports', { customerName: 'HC acc', serviceDate: '2026-11-03', totalAmount: 900000, paidAmount: 400000, accountId: acc.id });
  assert.equal(ps.status, 201);
  const tu = await api.post('/api/tours', { customerName: 'Tour acc', tourName: 'Sapa', sellAmount: 2000000, paid: 700000, accountId: acc.id });
  assert.equal(tu.status, 201);
  const tr = await api.post('/api/train-tickets', { customerName: 'Tàu acc', trainNo: 'SE3', ticketAmount: 500000, paid: 100000, accountId: acc.id });
  assert.equal(tr.status, 201);
  const nul = await api.post('/api/tours', { customerName: 'Tour null', sellAmount: 100, paid: 50, accountId: null });
  assert.equal(nul.status, 201);

  let r = await api.get(`/api/payments?passportId=${ps.body.id}`);
  assert.equal(r.body[0].account_id, acc.id);
  assert.equal(r.body[0].account_name, 'TK tạo dịch vụ');
  r = await api.get(`/api/payments?tourId=${tu.body.id}`);
  assert.equal(r.body[0].account_id, acc.id);
  r = await api.get(`/api/payments?trainTicketId=${tr.body.id}`);
  assert.equal(r.body[0].account_id, acc.id);
  r = await api.get(`/api/payments?tourId=${nul.body.id}`);
  assert.equal(r.body[0].account_id, null);

  const a = (await api.get('/api/accounts')).body.find((x) => x.id === acc.id);
  assert.equal(N(a.total_in), 1200000);
  assert.equal(N(a.balance), 1200000);
  // accountId sai → 400, không tạo dịch vụ
  const nTours = N((await h.pool.query('SELECT COUNT(*) FROM tours')).rows[0].count);
  const bad = await api.post('/api/tours', { customerName: 'Tour bad', sellAmount: 100, paid: 50, accountId: 999999 });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Tài khoản không hợp lệ');
  assert.equal(N((await h.pool.query('SELECT COUNT(*) FROM tours')).rows[0].count), nTours);
  // dọn để test sau không lẫn số liệu
  for (const [u, id] of [['passports', ps.body.id], ['tours', tu.body.id], ['train-tickets', tr.body.id], ['tours', nul.body.id]]) {
    assert.equal((await api.del(`/api/${u}/${id}`)).status, 200);
  }
  assert.equal((await api.del(`/api/accounts/${acc.id}`)).status, 200, 'hết giao dịch → xoá được');
});

test('accounts CRUD: validate, cập nhật từng phần, lưu trữ, xoá', async () => {
  assert.equal((await api.post('/api/accounts', {})).status, 400);
  assert.equal((await api.post('/api/accounts', { name: 'x'.repeat(101) })).status, 400);
  assert.equal((await api.post('/api/accounts', { name: 'A', openingBalance: 'abc' })).status, 400);

  const c = await api.post('/api/accounts', { name: 'TCB chính', bank: 'TCB', accountNumber: '123', holderName: 'Lộc', openingBalance: 1000000, notes: 'n' });
  assert.equal(c.status, 201);
  assert.equal(c.body.name, 'TCB chính');
  assert.equal(c.body.is_own, true);
  assert.equal(c.body.archived, false);
  assert.equal(N(c.body.opening_balance), 1000000);
  assert.equal(N(c.body.balance), 1000000);
  assert.equal(N(c.body.total_in), 0);
  assert.equal(c.body.unreconciled_count, 0);
  assert.equal(c.body.user_id, U.child.id);
  assert.ok('owner_name' in c.body);

  // Cập nhật từng phần: chỉ đổi bank, các field khác giữ nguyên.
  let u = await api.put(`/api/accounts/${c.body.id}`, { bank: 'VIB' });
  assert.equal(u.status, 200);
  assert.equal(u.body.bank, 'VIB');
  assert.equal(u.body.name, 'TCB chính');
  assert.equal(u.body.account_number, '123');
  assert.equal(N(u.body.opening_balance), 1000000);
  assert.equal((await api.put(`/api/accounts/${c.body.id}`, { name: '' })).status, 400, 'tên không được rỗng');
  u = await api.put(`/api/accounts/${c.body.id}`, { isOwn: false, openingBalance: 2000 });
  assert.equal(u.body.is_own, false);
  assert.equal(N(u.body.balance), 2000);

  // Lưu trữ: mặc định ẩn, includeArchived=1 thì hiện.
  u = await api.put(`/api/accounts/${c.body.id}`, { archived: true });
  assert.equal(u.body.archived, true);
  assert.ok(!(await api.get('/api/accounts')).body.some((a) => a.id === c.body.id));
  assert.ok((await api.get('/api/accounts?includeArchived=1')).body.some((a) => a.id === c.body.id));

  // Xoá (chưa có giao dịch) → OK, 404 lần 2.
  assert.equal((await api.del(`/api/accounts/${c.body.id}`)).status, 200);
  assert.equal((await api.del(`/api/accounts/${c.body.id}`)).status, 404);
  assert.equal((await api.put('/api/accounts/99999', { bank: 'x' })).status, 404);
  assert.equal((await api.get('/api/accounts/abc/ledger')).status, 400);

  // audit
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'money_account' AND entity_id = $1", [c.body.id]);
    return r.rows.length >= 4 ? r.rows : null;
  });
  assert.deepEqual([...new Set(audit.map((a) => a.action))].sort(), ['create', 'delete', 'update']);
});

test('số dư = đầu kỳ + vào − ra (payments, nạp ví, hoàn ví, trả NCC); trừ ví KHÔNG tính; sổ chi tiết from/to; đối soát; id ngoại → 400', async () => {
  const A = (await api.post('/api/accounts', { name: 'TK A', bank: 'TCB', openingBalance: 1000000 })).body;
  const B = (await api.post('/api/accounts', { name: 'TK chị Lan', isOwn: false })).body;
  const foreign = (await h.api(U.other.token).post('/api/accounts', { name: 'TK người lạ' })).body;

  // Vé có tiền trả trước vào TK A (ngày xuất 01/11).
  const d = await api.post('/api/debts', {
    customerName: 'Nguyễn A', phoneNumber: '0911', ticketCode: 'VN123', route: 'HAN-SGN', issueDate: '2026-11-01',
    ticketAmount: 3000000, paid: 500000, accountId: A.id,
  });
  assert.equal(d.status, 201);
  let pays = await api.get(`/api/payments?debtId=${d.body.id}`);
  assert.equal(pays.body[0].account_id, A.id);
  assert.equal(pays.body[0].account_name, 'TK A');
  assert.equal(pays.body[0].reconciled, false);

  // Thanh toán thêm vào A (10/11) và vào B (12/11).
  assert.equal((await api.post('/api/payments', { debtId: d.body.id, amount: 200000, paymentDate: '2026-11-10', method: 'bank_transfer', accountId: A.id })).status, 201);
  assert.equal((await api.post('/api/payments', { debtId: d.body.id, amount: 300000, paymentDate: '2026-11-12', accountId: B.id })).status, 201);

  // Ví: nạp 1tr vào A (05/11), hoàn 100k từ A (20/11), trừ ví 150k (không phải tiền vào TK).
  const cust = d.body.customer_id;
  assert.equal((await api.post(`/api/wallets/${cust}/topup`, { amount: 1000000, entryDate: '2026-11-05', accountId: A.id })).status, 201);
  assert.equal((await api.post(`/api/wallets/${cust}/refund`, { amount: 100000, entryDate: '2026-11-20', accountId: A.id })).status, 201);
  const w = await api.post('/api/payments', { debtId: d.body.id, amount: 150000, paymentDate: '2026-11-12', method: 'wallet', accountId: A.id });
  assert.equal(w.status, 201);
  assert.equal(w.body.account_id, null, 'trừ ví không gắn tài khoản');

  // Trả NCC 400k từ A (15/11).
  // 2 NCC phụ để id NCC ≠ id supplier_payment (kiểm tra ref.id có phân biệt được).
  await api.post('/api/suppliers', { name: 'NCC phụ 1' });
  await api.post('/api/suppliers', { name: 'NCC phụ 2' });
  const sup = (await api.post('/api/suppliers', { name: 'F1 Thùy Dương', kind: 'f1' })).body;
  const upd = await api.put(`/api/debts/${d.body.id}`, {
    customerName: 'Nguyễn A', phoneNumber: '0911', ticketCode: 'VN123', route: 'HAN-SGN', issueDate: '2026-11-01', ticketAmount: 3000000,
    costItems: [{ label: 'Giá vé F1', amount: 2500000, supplierId: sup.id }],
  });
  const itemId = upd.body.cost_items[0].id;
  const sp = await api.post(`/api/suppliers/${sup.id}/payments`, { amount: 400000, payDate: '2026-11-15', accountId: A.id, costItemId: itemId });
  assert.equal(sp.status, 201);

  // Số dư: A = 1.000.000 + (500k + 200k + 1tr) − (100k + 400k) = 2.200.000
  let list = (await api.get('/api/accounts')).body;
  let a = list.find((x) => x.id === A.id);
  assert.equal(N(a.total_in), 1700000);
  assert.equal(N(a.total_out), 500000);
  assert.equal(N(a.balance), 2200000);
  assert.equal(a.unreconciled_count, 5);
  const b = list.find((x) => x.id === B.id);
  assert.equal(N(b.balance), 300000);
  assert.equal(b.is_own, false);

  // Sổ chi tiết đầy đủ.
  let led = await api.get(`/api/accounts/${A.id}/ledger`);
  assert.equal(led.status, 200);
  assert.equal(led.body.account.id, A.id);
  assert.equal(N(led.body.opening), 1000000);
  assert.equal(N(led.body.closing), 2200000);
  assert.equal(N(led.body.total_in), 1700000);
  assert.equal(N(led.body.total_out), 500000);
  assert.deepEqual(led.body.rows.map((r) => [r.date, r.kind, r.direction, N(r.amount)]), [
    ['2026-11-01', 'payment', 'in', 500000],
    ['2026-11-05', 'topup', 'in', 1000000],
    ['2026-11-10', 'payment', 'in', 200000],
    ['2026-11-15', 'supplier_payment', 'out', 400000],
    ['2026-11-20', 'refund', 'out', 100000],
  ]);
  const byKind = Object.fromEntries(led.body.rows.map((r) => [r.kind + r.date, r]));
  assert.equal(byKind['payment2026-11-01'].description, 'Khách Nguyễn A · Vé VN123 HAN-SGN');
  assert.deepEqual(byKind['payment2026-11-01'].ref, { type: 'debt', id: d.body.id });
  assert.equal(byKind['payment2026-11-01'].customer_name, 'Nguyễn A');
  assert.equal(byKind['topup2026-11-05'].description, 'Nạp ví · Nguyễn A');
  assert.deepEqual(byKind['topup2026-11-05'].ref, { type: 'wallet', id: cust });
  assert.equal(byKind['supplier_payment2026-11-15'].description, 'Trả F1 Thùy Dương · Giá vé F1 (vé VN123 HAN-SGN)');
  assert.equal(byKind['supplier_payment2026-11-15'].supplier_name, 'F1 Thùy Dương');
  assert.deepEqual(byKind['supplier_payment2026-11-15'].ref, { type: 'supplier', id: sup.id });
  // ref.id của dòng trả NCC = id NHÀ CUNG CẤP; id của chính dòng = id supplier_payment.
  assert.equal(byKind['supplier_payment2026-11-15'].ref.id, sup.id);
  assert.equal(byKind['supplier_payment2026-11-15'].id, sp.body.id);
  assert.notEqual(sp.body.id, sup.id);
  // customer_id có ở mọi dòng biết được khách
  assert.ok(led.body.rows.every((r) => r.customer_id === cust), 'customer_id trên mọi dòng');
  assert.equal(byKind['refund2026-11-20'].description, 'Hoàn ví · Nguyễn A');
  assert.ok(led.body.rows.every((r) => r.reconciled === false));

  // from/to: opening = 1tr + 500k + 1tr (trước 06/11); trong kỳ: +200k, −400k.
  led = await api.get(`/api/accounts/${A.id}/ledger?from=2026-11-06&to=2026-11-16`);
  assert.equal(N(led.body.opening), 2500000);
  assert.deepEqual(led.body.rows.map((r) => r.kind), ['payment', 'supplier_payment']);
  assert.equal(N(led.body.total_in), 200000);
  assert.equal(N(led.body.total_out), 400000);
  assert.equal(N(led.body.closing), 2300000);
  assert.equal((await api.get(`/api/accounts/${A.id}/ledger?from=bad`)).status, 400);

  // Đối soát 3 loại → unreconciled giảm; bỏ đối soát → tăng lại.
  const payRow = led.body.rows.find((r) => r.kind === 'payment');
  const topupId = (await api.get(`/api/accounts/${A.id}/ledger`)).body.rows.find((r) => r.kind === 'topup').id;
  assert.deepEqual((await api.put('/api/accounts/reconcile', { kind: 'payment', id: payRow.id, reconciled: true })).body, { ok: true });
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'wallet', id: topupId, reconciled: true })).status, 200);
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'supplier_payment', id: sp.body.id, reconciled: true })).status, 200);
  a = (await api.get('/api/accounts')).body.find((x) => x.id === A.id);
  assert.equal(a.unreconciled_count, 2);
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'supplier_payment', id: sp.body.id, reconciled: false })).status, 200);
  a = (await api.get('/api/accounts')).body.find((x) => x.id === A.id);
  assert.equal(a.unreconciled_count, 3);
  const r1 = await h.pool.query('SELECT reconciled FROM payments WHERE id = $1', [payRow.id]);
  assert.equal(r1.rows[0].reconciled, true);
  // reconcile validate + chỉ dữ liệu của mình
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'xyz', id: 1, reconciled: true })).status, 400);
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'payment', id: payRow.id })).status, 400);
  assert.equal((await h.api(U.other.token).put('/api/accounts/reconcile', { kind: 'payment', id: payRow.id, reconciled: false })).status, 404);
  assert.equal((await h.api(U.agency.token).put('/api/accounts/reconcile', { kind: 'payment', id: payRow.id, reconciled: false })).status, 404);

  // Xoá TK đã có giao dịch → 400, dữ liệu còn nguyên.
  const del = await api.del(`/api/accounts/${A.id}`);
  assert.equal(del.status, 400);
  assert.match(del.body.error, /lưu trữ thay vì xoá/);
  assert.equal((await api.del(`/api/accounts/${B.id}`)).status, 400, 'B có payment');
  assert.equal((await h.pool.query('SELECT 1 FROM money_accounts WHERE id = $1', [A.id])).rows.length, 1);

  // accountId của người khác → 400 ở mọi nơi, không ghi gì.
  const before = (await h.pool.query('SELECT (SELECT COUNT(*) FROM payments) p, (SELECT COUNT(*) FROM wallet_entries) w, (SELECT COUNT(*) FROM supplier_payments) s, (SELECT COUNT(*) FROM debts) d')).rows[0];
  let bad = await api.post('/api/payments', { debtId: d.body.id, amount: 1000, accountId: foreign.id });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'Tài khoản không hợp lệ');
  assert.equal((await api.post('/api/debts', { customerName: 'X', ticketAmount: 1000, paid: 1000, accountId: foreign.id })).status, 400);
  assert.equal((await api.post('/api/passports', { customerName: 'X', serviceDate: '2026-11-01', totalAmount: 1000, paidAmount: 10, accountId: foreign.id })).status, 400);
  assert.equal((await api.post(`/api/wallets/${cust}/topup`, { amount: 1000, accountId: foreign.id })).status, 400);
  assert.equal((await api.post(`/api/wallets/${cust}/refund`, { amount: 1000, accountId: foreign.id })).status, 400);
  assert.equal((await api.post(`/api/suppliers/${sup.id}/payments`, { amount: 1000, accountId: foreign.id })).status, 400);
  bad = await api.put(`/api/debts/${d.body.id}`, {
    customerName: 'Nguyễn A', phoneNumber: '0911', ticketAmount: 3000000,
    costItems: [{ id: itemId, label: 'Giá vé F1', amount: 2500000, supplierId: sup.id, payNow: { accountId: foreign.id } }],
  });
  assert.equal(bad.status, 400);
  assert.equal((await api.post('/api/payments', { debtId: d.body.id, amount: 1000, accountId: 'abc' })).status, 400);
  const afterCounts = (await h.pool.query('SELECT (SELECT COUNT(*) FROM payments) p, (SELECT COUNT(*) FROM wallet_entries) w, (SELECT COUNT(*) FROM supplier_payments) s, (SELECT COUNT(*) FROM debts) d')).rows[0];
  assert.deepEqual(afterCounts, before, 'không có gì bị ghi khi id ngoại sai');

  // Phạm vi: agency (cha) xem được TK của child, không sửa/xoá được; người lạ không thấy.
  const ag = h.api(U.agency.token);
  const agList = await ag.get('/api/accounts');
  assert.ok(agList.body.some((x) => x.id === A.id));
  assert.ok((await ag.get(`/api/accounts?agencyId=${U.child.id}`)).body.every((x) => x.user_id === U.child.id));
  assert.equal((await ag.get(`/api/accounts/${A.id}/ledger`)).status, 200);
  assert.equal((await ag.put(`/api/accounts/${A.id}`, { name: 'hack' })).status, 404);
  assert.equal((await ag.del(`/api/accounts/${A.id}`)).status, 404);
  assert.equal((await h.api(U.other.token).get(`/api/accounts/${A.id}/ledger`)).status, 404);
  assert.ok(!(await h.api(U.other.token).get('/api/accounts')).body.some((x) => x.id === A.id));
  assert.equal((await api.get('/api/accounts')).body.find((x) => x.id === A.id).name, 'TK A');

  // Thiếu token → 401
  assert.equal((await h.api(null).get('/api/accounts')).status, 401);
});
