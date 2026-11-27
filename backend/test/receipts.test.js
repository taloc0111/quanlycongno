// test/receipts.test.js — Dòng tiền v3.1: phiếu thu nhiều vé (chia cho nhiều dịch vụ, thừa vào ví),
// sổ TK hiện 1 dòng/phiếu, đối soát phiếu, xoá phiếu (chặn khi ví đã tiêu), công nợ theo khách,
// trả thừa qua POST /api/payments, chạy song song xoá phiếu ↔ trừ ví.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
let api;
let ACC;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
  ACC = (await api.post('/api/accounts', { name: 'TCB phiếu', openingBalance: 0 })).body;
});
after(() => h.stop());

const N = (x) => Number(x);
const accBal = async (id = ACC.id) => N((await api.get('/api/accounts')).body.find((a) => a.id === id).balance);
const wallet = async (cid) => N((await api.get(`/api/wallets/${cid}`)).body.balance);
const paidOf = async (table, col, id) => N((await h.pool.query(`SELECT ${col} AS p FROM ${table} WHERE id = $1`, [id])).rows[0].p);
const counts = async () => (await h.pool.query(
  'SELECT (SELECT COUNT(*) FROM receipts)::int r, (SELECT COUNT(*) FROM payments)::int p, (SELECT COUNT(*) FROM wallet_entries)::int w'
)).rows[0];
async function ledgerConsistent(accountId) {
  const led = (await api.get(`/api/accounts/${accountId}/ledger`)).body;
  let run = N(led.opening);
  for (const r of led.rows) run += r.direction === 'in' ? N(r.amount) : -N(r.amount);
  assert.equal(Math.round(run * 100), Math.round(N(led.closing) * 100), 'luỹ kế = closing');
  assert.equal(N(led.closing), await accBal(accountId), 'closing = balance');
  return led;
}

test('công nợ theo khách: chỉ dịch vụ còn nợ, chưa huỷ, cũ trước; phạm vi', async () => {
  const k = { customerName: 'Khách Nợ', phoneNumber: '0901' };
  const tu = (await api.post('/api/tours', { ...k, tourName: 'Sapa', sellAmount: 3000000, issueDate: '2026-11-01', dueDate: '2026-11-20' })).body;
  const d = (await api.post('/api/debts', { ...k, ticketCode: 'VN1', route: 'HAN-SGN', ticketAmount: 1000000, paid: 200000, issueDate: '2026-10-01' })).body;
  const cid = d.customer_id;
  assert.equal(tu.customer_id, cid);
  await api.post('/api/passports', { ...k, passportNumber: 'P1', serviceDate: '2026-09-01', totalAmount: 500000, paidAmount: 500000 }); // đã trả đủ
  const tr = (await api.post('/api/train-tickets', { ...k, trainNo: 'SE1', ticketAmount: 400000, issueDate: '2026-08-01' })).body;
  assert.equal((await api.post(`/api/train-tickets/${tr.id}/cancel`, { finalAmount: 0 })).status, 200); // huỷ, miễn phí → hết nợ → bỏ

  const r = await api.get(`/api/customers/${cid}/outstanding`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((x) => [x.type, x.id, x.label, x.issue_date, N(x.total), N(x.paid), N(x.remaining)]), [
    ['debt', d.id, 'Vé VN1 HAN-SGN', '2026-10-01', 1000000, 200000, 800000],
    ['tour', tu.id, 'Tour Sapa', '2026-11-01', 3000000, 0, 3000000],
  ]);
  assert.equal(r.body[1].due_date, '2026-11-20');
  assert.equal((await h.api(U.agency.token).get(`/api/customers/${cid}/outstanding`)).body.length, 2);
  assert.equal((await h.api(U.other.token).get(`/api/customers/${cid}/outstanding`)).status, 404);
  assert.equal((await api.get('/api/customers/abc/outstanding')).status, 400);
  assert.equal((await h.api(null).get(`/api/customers/${cid}/outstanding`)).status, 401);
});

test('phiếu thu: 1 lần chuyển chia vé + tour cùng khách, thừa vào ví; sổ 1 dòng; đối soát; xoá có chặn ví đã tiêu', async () => {
  const k = { customerName: 'Khách Phiếu', phoneNumber: '0902' };
  const d = (await api.post('/api/debts', { ...k, ticketCode: 'VJ2', route: 'SGN-DAD', ticketAmount: 1000000, paid: 200000, issueDate: '2026-11-01' })).body;
  const tu = (await api.post('/api/tours', { ...k, tourName: 'Đà Lạt', sellAmount: 3000000, issueDate: '2026-11-02' })).body;
  const cid = d.customer_id;
  const accBefore = await accBal();
  const c0 = await counts();

  // Lỗi → không ghi gì
  const base = { accountId: ACC.id, customerId: cid, receiptDate: '2026-11-15', method: 'bank_transfer' };
  const bad = [
    [{ ...base, amount: 5000000, allocations: [{ type: 'debt', id: d.id, amount: 900000 }] }, /vượt số còn nợ/],
    [{ ...base, amount: 500000, allocations: [{ type: 'debt', id: d.id, amount: 300000 }, { type: 'tour', id: tu.id, amount: 300000 }] }, /vượt số tiền phiếu thu/],
    [{ ...base, customerId: undefined, amount: 1000000, allocations: [{ type: 'debt', id: d.id, amount: 800000 }] }, /cần chọn khách/],
    [{ ...base, method: 'wallet', amount: 100, allocations: [] }, /trừ ví/],
    [{ ...base, amount: 0, allocations: [] }, /lớn hơn 0/],
    [{ ...base, amount: 100, allocations: [{ type: 'debt', id: d.id, amount: 50 }, { type: 'debt', id: d.id, amount: 50 }] }, /trùng/],
    [{ ...base, amount: 100, allocations: [{ type: 'xyz', id: d.id, amount: 50 }] }, /loại dịch vụ/],
    [{ ...base, amount: 100, allocations: [{ type: 'debt', id: d.id, amount: 0 }] }, /lớn hơn 0/],
  ];
  for (const [body, re] of bad) {
    const r = await api.post('/api/receipts', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.body.error, re);
  }
  // id ngoại
  const foreignDebt = (await h.api(U.other.token).post('/api/debts', { customerName: 'Lạ', ticketAmount: 100000 })).body;
  const foreignAcc = (await h.api(U.other.token).post('/api/accounts', { name: 'TK lạ' })).body;
  assert.equal((await api.post('/api/receipts', { ...base, amount: 100, allocations: [{ type: 'debt', id: foreignDebt.id, amount: 100 }] })).status, 400);
  assert.equal((await api.post('/api/receipts', { ...base, accountId: foreignAcc.id, amount: 100, allocations: [] })).body.error, 'Tài khoản không hợp lệ');
  assert.equal((await api.post('/api/receipts', { ...base, customerId: foreignDebt.customer_id, amount: 100, allocations: [] })).body.error, 'Khách hàng không hợp lệ');
  assert.equal((await h.api(U.agency.token).post('/api/receipts', { ...base, amount: 100, allocations: [{ type: 'debt', id: d.id, amount: 100 }] })).status, 400, 'cấp trên không ghi được');
  assert.deepEqual(await counts(), c0, 'không ghi gì khi lỗi');

  // Hợp lệ: 5tr = 800k vé + 3tr tour + 1,2tr vào ví
  const r = await api.post('/api/receipts', {
    ...base, amount: 5000000, notes: 'CK VCB', allocations: [{ type: 'debt', id: d.id, amount: 800000 }, { type: 'tour', id: tu.id, amount: 3000000 }],
  });
  assert.equal(r.status, 201);
  assert.equal(N(r.body.receipt.amount), 5000000);
  assert.equal(r.body.receipt.customer_name, 'Khách Phiếu');
  assert.equal(r.body.receipt.account_name, 'TCB phiếu');
  assert.equal(r.body.payments.length, 2);
  assert.ok(r.body.payments.every((p) => p.receipt_id === r.body.receipt.id && p.account_id === ACC.id && p.payment_date === '2026-11-15'));
  assert.equal(N(r.body.walletTopup.amount), 1200000);
  assert.equal(r.body.walletTopup.receipt_id, r.body.receipt.id);
  const rid = r.body.receipt.id;
  assert.equal(await paidOf('debts', 'paid', d.id), 1000000);
  assert.equal(await paidOf('tours', 'paid', tu.id), 3000000);
  assert.equal(await wallet(cid), 1200000);
  assert.equal(await accBal(), accBefore + 5000000);
  assert.equal((await api.get(`/api/customers/${cid}/outstanding`)).body.length, 0, 'hết nợ');

  // GET /receipts
  const list = (await api.get(`/api/receipts?customerId=${cid}`)).body;
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].allocations.map((a) => [a.type, a.id, a.label, N(a.amount)]), [
    ['debt', d.id, 'Vé VJ2 SGN-DAD', 800000], ['tour', tu.id, 'Tour Đà Lạt', 3000000],
  ]);
  assert.equal(N(list[0].wallet_amount), 1200000);
  assert.equal((await h.api(U.agency.token).get('/api/receipts')).body.length, 1);
  assert.equal((await h.api(U.other.token).get('/api/receipts')).body.length, 0);

  // Sổ TK: đúng 1 dòng receipt (không hiện payment con / nạp ví riêng)
  let led = await ledgerConsistent(ACC.id);
  const recRows = led.rows.filter((x) => x.kind === 'receipt');
  assert.equal(recRows.length, 1);
  assert.equal(N(recRows[0].amount), 5000000);
  assert.equal(recRows[0].direction, 'in');
  assert.deepEqual(recRows[0].ref, { type: 'receipt', id: rid });
  assert.equal(recRows[0].id, rid, 'id dòng sổ = receipts.id (FE gọi DELETE /receipts/:id)');
  assert.equal(recRows[0].description, 'Khách Khách Phiếu · Vé VJ2 SGN-DAD, Tour Đà Lạt · vào ví 1.200.000₫');
  assert.ok(!led.rows.some((x) => (x.kind === 'payment' && r.body.payments.some((p) => p.id === x.id)) || x.kind === 'topup'));

  // Đối soát phiếu → đánh dấu cả con
  const unrec0 = (await api.get('/api/accounts')).body.find((a) => a.id === ACC.id).unreconciled_count;
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'receipt', id: rid, reconciled: true })).status, 200);
  const rc = (await h.pool.query(
    `SELECT (SELECT bool_and(reconciled) FROM payments WHERE receipt_id = $1) p, (SELECT bool_and(reconciled) FROM wallet_entries WHERE receipt_id = $1) w,
            (SELECT reconciled FROM receipts WHERE id = $1) r`, [rid]
  )).rows[0];
  assert.deepEqual(rc, { p: true, w: true, r: true });
  assert.equal((await api.get('/api/accounts')).body.find((a) => a.id === ACC.id).unreconciled_count, unrec0 - 1);
  assert.equal((await h.api(U.other.token).put('/api/accounts/reconcile', { kind: 'receipt', id: rid, reconciled: false })).status, 404);

  // Không xoá lẻ con của phiếu
  assert.equal((await api.del(`/api/payments/${r.body.payments[0].id}`)).status, 400);
  assert.equal((await api.del(`/api/wallets/entries/${r.body.walletTopup.id}`)).status, 400);

  // Ví đã tiêu 500k (trừ ví cho vé khác) → xoá phiếu bị chặn
  const d2 = (await api.post('/api/debts', { ...k, ticketCode: 'VJ3', ticketAmount: 1000000, issueDate: '2026-11-16' })).body;
  const spend = await api.post('/api/payments', { debtId: d2.id, amount: 500000, method: 'wallet' });
  assert.equal(spend.status, 201);
  assert.equal(await wallet(cid), 700000);
  const blocked = await api.del(`/api/receipts/${rid}`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Ví khách đã dùng/);
  assert.equal(await paidOf('debts', 'paid', d.id), 1000000, 'không đổi gì');
  assert.equal((await h.api(U.agency.token).del(`/api/receipts/${rid}`)).status, 404);

  // Gỡ khoản tiêu → xoá được, mọi số về như trước
  assert.equal((await api.del(`/api/payments/${spend.body.id}`)).status, 200);
  assert.equal((await api.del(`/api/receipts/${rid}`)).status, 200);
  assert.equal((await api.del(`/api/receipts/${rid}`)).status, 404);
  assert.equal(await paidOf('debts', 'paid', d.id), 200000);
  assert.equal(await paidOf('tours', 'paid', tu.id), 0);
  assert.equal(await wallet(cid), 0);
  assert.equal(await accBal(), accBefore);
  await ledgerConsistent(ACC.id);
  const audit = await h.waitFor(async () => {
    const x = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'receipt' AND entity_id = $1", [rid]);
    return x.rows.length >= 2 ? x.rows.map((y) => y.action).sort() : null;
  });
  assert.deepEqual(audit, ['delete', 'payment']);
  assert.equal((await h.api(null).get('/api/receipts')).status, 401);
});

test('phiếu thu toàn bộ vào ví (không phân bổ); xoá dịch vụ con vẫn giữ sổ khớp số dư', async () => {
  const k = { customerName: 'Khách Ví', phoneNumber: '0903' };
  const d = (await api.post('/api/debts', { ...k, ticketAmount: 600000, issueDate: '2026-11-03' })).body;
  const r = await api.post('/api/receipts', { accountId: ACC.id, customerId: d.customer_id, amount: 900000, allocations: [{ type: 'debt', id: d.id, amount: 600000 }] });
  assert.equal(r.status, 201);
  const only = await api.post('/api/receipts', { accountId: ACC.id, customerId: d.customer_id, amount: 100000 });
  assert.equal(only.status, 201);
  assert.equal(only.body.payments.length, 0);
  assert.equal(N(only.body.walletTopup.amount), 100000);
  await ledgerConsistent(ACC.id);
  // xoá vé con: payment con mất theo (CASCADE), dòng phiếu trên sổ = phần còn lại (nạp ví)
  assert.equal((await api.del(`/api/debts/${d.id}`)).status, 200);
  const led = await ledgerConsistent(ACC.id);
  assert.equal(N(led.rows.find((x) => x.kind === 'receipt' && x.id === r.body.receipt.id).amount), 300000);
  // dọn
  assert.equal((await api.del(`/api/receipts/${r.body.receipt.id}`)).status, 200);
  assert.equal((await api.del(`/api/receipts/${only.body.receipt.id}`)).status, 200);
  assert.equal(await wallet(d.customer_id), 0);
});

test('trả thừa qua POST /payments: phần thừa vào ví; đã trả đủ → toàn bộ vào ví; noOverflow / không có khách / trừ ví giữ hành vi cũ', async () => {
  const k = { customerName: 'Khách Thừa', phoneNumber: '0904' };
  const d = (await api.post('/api/debts', { ...k, ticketCode: 'QH1', ticketAmount: 1000000, issueDate: '2026-11-05' })).body;
  const cid = d.customer_id;
  const acc0 = await accBal();

  let p = await api.post('/api/payments', { debtId: d.id, amount: 1300000, accountId: ACC.id, method: 'bank_transfer', paymentDate: '2026-11-06' });
  assert.equal(p.status, 201);
  assert.equal(p.body.overflowToWallet, 300000);
  assert.ok(p.body.receiptId);
  assert.equal(N(p.body.amount), 1000000);
  assert.equal(p.body.receipt_id, p.body.receiptId);
  assert.equal(await paidOf('debts', 'paid', d.id), 1000000);
  assert.equal(await wallet(cid), 300000);
  assert.equal(await accBal(), acc0 + 1300000);
  const led = await ledgerConsistent(ACC.id);
  assert.equal(N(led.rows.find((x) => x.kind === 'receipt' && x.id === p.body.receiptId).amount), 1300000);

  // Đã trả đủ → toàn bộ vào ví, không có payment
  p = await api.post('/api/payments', { debtId: d.id, amount: 100000, accountId: ACC.id });
  assert.equal(p.status, 201);
  assert.equal(p.body.id, null);
  assert.equal(p.body.overflowToWallet, 100000);
  assert.equal(await wallet(cid), 400000);
  assert.equal(await paidOf('debts', 'paid', d.id), 1000000);

  // Trả đúng số còn nợ → không tạo phiếu
  const d2 = (await api.post('/api/debts', { ...k, ticketAmount: 500000 })).body;
  p = await api.post('/api/payments', { debtId: d2.id, amount: 500000 });
  assert.equal(p.body.overflowToWallet, 0);
  assert.equal(p.body.receiptId, null);
  assert.equal(p.body.receipt_id, null);

  // noOverflow → như cũ (paid > tổng)
  const d3 = (await api.post('/api/debts', { ...k, ticketAmount: 500000 })).body;
  p = await api.post('/api/payments', { debtId: d3.id, amount: 700000, noOverflow: true });
  assert.equal(p.status, 201);
  assert.equal(p.body.overflowToWallet, 0);
  assert.equal(await paidOf('debts', 'paid', d3.id), 700000);
  assert.equal(await wallet(cid), 400000);

  // Trừ ví vượt số còn nợ → như cũ (không tạo phiếu)
  p = await api.post('/api/payments', { debtId: d2.id, amount: 100000, method: 'wallet' });
  assert.equal(p.status, 201);
  assert.equal(p.body.receiptId, null);
  assert.equal(await wallet(cid), 300000);

  // Dịch vụ không có khách → như cũ
  const t = (await h.pool.query(
    "INSERT INTO tours (user_id, customer_name, sell_amount) VALUES ($1, 'Tour không khách', 200000) RETURNING id", [U.child.id]
  )).rows[0];
  p = await api.post('/api/payments', { tourId: t.id, amount: 350000 });
  assert.equal(p.status, 201);
  assert.equal(p.body.overflowToWallet, 0);
  assert.equal(await paidOf('tours', 'paid', t.id), 350000);

  // Hộ chiếu / vé tàu cũng chạy
  const ps = (await api.post('/api/passports', { ...k, serviceDate: '2026-11-05', totalAmount: 100000 })).body;
  p = await api.post('/api/payments', { passportId: ps.id, amount: 150000 });
  assert.equal(p.body.overflowToWallet, 50000);
  assert.equal(await paidOf('passports', 'paid_amount', ps.id), 100000);
  const tr = (await api.post('/api/train-tickets', { ...k, ticketAmount: 100000 })).body;
  p = await api.post('/api/payments', { trainTicketId: tr.id, amount: 120000 });
  assert.equal(p.body.overflowToWallet, 20000);
  assert.equal(await wallet(cid), 370000);

  // id ngoại / cấp trên → như cũ (403 / 400), không ghi gì
  const c0 = await counts();
  assert.equal((await h.api(U.agency.token).post('/api/payments', { debtId: d.id, amount: 10 })).status, 403);
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 10, accountId: 999999 })).status, 400);
  assert.deepEqual(await counts(), c0);
});

test('song song: xoá phiếu thu ↔ trừ ví phần thừa — đúng 1 bên thành công, ví không bao giờ âm', async () => {
  const k = { customerName: 'Khách Đua', phoneNumber: '0905' };
  for (let round = 0; round < 3; round++) {
    const d = (await api.post('/api/debts', { ...k, ticketAmount: 100000 })).body;
    const d2 = (await api.post('/api/debts', { ...k, ticketAmount: 5000000 })).body;
    const cid = d.customer_id;
    const r = (await api.post('/api/receipts', { accountId: ACC.id, customerId: cid, amount: 1100000, allocations: [{ type: 'debt', id: d.id, amount: 100000 }] })).body;
    const w0 = await wallet(cid);
    const [del, pay] = await Promise.all([
      api.del(`/api/receipts/${r.receipt.id}`),
      api.post('/api/payments', { debtId: d2.id, amount: w0, method: 'wallet' }),
    ]);
    const ok = [del.status === 200, pay.status === 201].filter(Boolean).length;
    assert.equal(ok, 1, `round ${round}: del ${del.status} pay ${pay.status}`);
    assert.ok((await wallet(cid)) >= 0);
    // dọn cho vòng sau
    if (pay.status === 201) {
      assert.equal((await api.del(`/api/payments/${pay.body.id}`)).status, 200);
      assert.equal((await api.del(`/api/receipts/${r.receipt.id}`)).status, 200);
    }
    assert.equal(await wallet(cid), 0);
    assert.equal(await paidOf('debts', 'paid', d.id), 0);
  }
  // Nhiều lần trừ ví song song không vượt phần thừa của phiếu
  const d = (await api.post('/api/debts', { ...k, ticketAmount: 9000000 })).body;
  await api.post('/api/receipts', { accountId: ACC.id, customerId: d.customer_id, amount: 300000 });
  const many = await Promise.all(Array.from({ length: 6 }, () => api.post('/api/payments', { debtId: d.id, amount: 100000, method: 'wallet' })));
  assert.equal(many.filter((x) => x.status === 201).length, 3);
  assert.equal(await wallet(d.customer_id), 0);
});
