// test/debts.test.js — vé máy bay: CRUD, scope đại lý, validation, companyId, invoice IDOR, import.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
before(async () => {
  await h.start();
  U = await h.seedUsers();
});
after(() => h.stop());

const debtBody = (over = {}) => ({
  customerName: 'Nguyễn Văn A', phoneNumber: '0901234567', ticketCode: 'ABC123', airline: 'VJ', route: 'SGN-HAN',
  flightDate: '2026-12-25', issueDate: '2026-12-01', dueDate: '2026-12-20', ticketAmount: 1500000, costAmount: 1200000,
  paid: 500000, notes: '', companyId: '', ...over,
});

test('create/update/delete + scope: agency xem được của child nhưng không sửa/thu tiền', async () => {
  const child = h.api(U.child.token);
  const c = await child.post('/api/debts', debtBody());
  assert.equal(c.status, 201);
  assert.equal(c.body.user_id, U.child.id);
  assert.equal(c.body.flight_date, '2026-12-25', 'DATE là chuỗi');
  assert.equal(Number(c.body.paid), 500000);
  assert.equal(c.body.company_id, null);
  // paid → 1 payment
  const pays = await child.get(`/api/payments?debtId=${c.body.id}`);
  assert.equal(pays.body.length, 1);
  assert.equal(Number(pays.body[0].amount), 500000);

  // agency thấy (read-only)
  const list = await h.api(U.agency.token).get('/api/debts');
  assert.equal(list.status, 200);
  assert.ok(list.body.some((d) => d.id === c.body.id));
  assert.ok('agency_paid' in list.body[0]);
  assert.equal((await h.api(U.agency.token).get(`/api/debts?agencyId=${U.child.id}`)).body.length, 1);
  // other không thấy
  assert.equal((await h.api(U.other.token).get('/api/debts')).body.length, 0);

  // agency PUT → 404, payment POST → 403, DELETE → 404
  assert.equal((await h.api(U.agency.token).put(`/api/debts/${c.body.id}`, debtBody({ notes: 'hack' }))).status, 404);
  const pay = await h.api(U.agency.token).post('/api/payments', { debtId: c.body.id, amount: 1000 });
  assert.equal(pay.status, 403);
  assert.equal((await h.api(U.agency.token).del(`/api/debts/${c.body.id}`)).status, 404);

  // chủ sở hữu sửa: paid không đổi dù body gửi paid khác
  const u = await child.put(`/api/debts/${c.body.id}`, debtBody({ ticketAmount: 1600000, paid: 999, dueDate: '' }));
  assert.equal(u.status, 200);
  assert.equal(Number(u.body.ticket_amount), 1600000);
  assert.equal(Number(u.body.paid), 500000);
  assert.equal(u.body.due_date, null);

  // check-in
  const ci = await child.put(`/api/debts/${c.body.id}/checkin`, { checkedIn: true });
  assert.equal(ci.body.checked_in, true);

  const d = await child.del(`/api/debts/${c.body.id}`);
  assert.equal(d.status, 200);
  assert.equal((await child.get(`/api/payments?debtId=${c.body.id}`)).body.length, 0, 'payments cascade');

  // audit có create/update/delete (ghi nền → không so thứ tự id)
  const rows = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT action, username, summary FROM audit_logs WHERE entity = 'debt' AND entity_id = $1", [c.body.id]);
    return r.rows.length >= 3 ? r.rows : null;
  });
  assert.deepEqual(rows.map((r) => r.action).sort(), ['create', 'delete', 'update']);
  assert.ok(rows.every((r) => r.username === 'child' && r.summary.includes('ABC123')));
});

test('validation 400: body rỗng, số tiền sai, SĐT dài, âm, ngày sai, id sai', async () => {
  const api = h.api(U.child.token);
  let r = await api.post('/api/debts', {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Tên khách hàng/);
  r = await api.post('/api/debts', debtBody({ ticketAmount: 'abc' }));
  assert.equal(r.status, 400);
  r = await api.post('/api/debts', debtBody({ ticketAmount: -5 }));
  assert.equal(r.status, 400);
  r = await api.post('/api/debts', debtBody({ paid: -1 }));
  assert.equal(r.status, 400);
  r = await api.post('/api/debts', debtBody({ phoneNumber: '0'.repeat(21) }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /tối đa 20/);
  r = await api.post('/api/debts', debtBody({ flightDate: '2026-02-30' }));
  assert.equal(r.status, 400);
  r = await api.post('/api/debts', debtBody({ flightDate: 'hôm qua' }));
  assert.equal(r.status, 400);
  r = await api.put('/api/debts/xyz', debtBody());
  assert.equal(r.status, 400);
  // body không phải JSON object → coi như rỗng → 400 chứ không 500
  r = await api.post('/api/debts', '"chuỗi"');
  assert.equal(r.status, 400);
  r = await api.post('/api/debts', '{bad json');
  assert.equal(r.status, 400);
  // '' cho số/ngày → NULL/0, không lỗi
  r = await api.post('/api/debts', debtBody({ costAmount: '', paid: '', flightDate: '', issueDate: '' }));
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.cost_amount), 0);
  assert.equal(r.body.flight_date, null);
  assert.match(r.body.issue_date, /^\d{4}-\d{2}-\d{2}$/, 'issue_date mặc định hôm nay');
});

test('companyId: của người khác → 400; của mình → OK (debts/passports/train/tours/customers)', async () => {
  const mine = await h.api(U.child.token).post('/api/companies', { name: 'Cty của child' });
  assert.equal(mine.status, 201);
  const foreign = await h.api(U.other.token).post('/api/companies', { name: 'Cty của other' });
  assert.equal(foreign.status, 201);
  const api = h.api(U.child.token);

  const cases = [
    ['/api/debts', debtBody()],
    ['/api/passports', { customerName: 'HC', serviceDate: '2026-11-01', totalAmount: 100 }],
    ['/api/train-tickets', { customerName: 'VT', ticketAmount: 100 }],
    ['/api/tours', { customerName: 'TR', sellAmount: 100 }],
    ['/api/customers', { name: 'KH', type: 'company' }],
  ];
  for (const [path, body] of cases) {
    const bad = await api.post(path, { ...body, companyId: foreign.body.id });
    assert.equal(bad.status, 400, `${path} companyId lạ`);
    assert.equal(bad.body.error, 'Công ty không hợp lệ');
    const ghost = await api.post(path, { ...body, companyId: 99999 });
    assert.equal(ghost.status, 400, `${path} companyId không tồn tại`);
    const ok = await api.post(path, { ...body, companyId: mine.body.id });
    assert.equal(ok.status, 201, `${path} companyId của mình`);
    assert.equal(ok.body.company_id, mine.body.id);
    const upd = await api.put(`${path}/${ok.body.id}`, { ...body, companyId: foreign.body.id });
    assert.equal(upd.status, 400, `${path} update companyId lạ`);
  }
});

test('invoice: customerId/debtId của người khác → 400; update status enum, clear due_date, thay items', async () => {
  const otherCust = await h.api(U.other.token).post('/api/customers', { name: 'Khách của other' });
  const otherDebt = await h.api(U.other.token).post('/api/debts', debtBody({ paid: 0 }));
  const myCust = await h.api(U.child.token).post('/api/customers', { name: 'Khách của child' });
  const myDebt = await h.api(U.child.token).post('/api/debts', debtBody({ paid: 0 }));
  const api = h.api(U.child.token);
  const items = [{ description: 'Vé', quantity: 1, unitPrice: 1000000, debtId: myDebt.body.id }];

  let r = await api.post('/api/invoices', { invoiceNumber: 'INV-1', customerId: otherCust.body.id, items });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Khách hàng không hợp lệ');
  r = await api.post('/api/invoices', { invoiceNumber: 'INV-1', customerId: myCust.body.id, items: [{ ...items[0], debtId: otherDebt.body.id }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Vé #\d+ không hợp lệ/);
  r = await api.post('/api/invoices', { invoiceNumber: 'INV-1', customerId: myCust.body.id, items: [] });
  assert.equal(r.status, 400);

  r = await api.post('/api/invoices', { invoiceNumber: 'INV-1', customerId: myCust.body.id, dueDate: '2026-12-31', taxAmount: 100000, items });
  assert.equal(r.status, 201);
  assert.equal(Number(r.body.subtotal), 1000000);
  assert.equal(Number(r.body.total_amount), 1100000);
  assert.equal(r.body.due_date, '2026-12-31');
  const id = r.body.id;

  assert.equal((await api.put(`/api/invoices/${id}`, { status: 'weird' })).status, 400);
  r = await api.put(`/api/invoices/${id}`, { status: 'paid', dueDate: null, notes: null });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'paid');
  assert.equal(r.body.due_date, null);
  assert.equal(r.body.notes, null);

  r = await api.put(`/api/invoices/${id}`, { items: [{ description: 'A', quantity: 2, unitPrice: 300000 }, { description: 'B', quantity: 1, unitPrice: 50000 }], taxAmount: 0 });
  assert.equal(r.status, 200);
  assert.equal(Number(r.body.subtotal), 650000);
  assert.equal(Number(r.body.total_amount), 650000);
  const full = await api.get(`/api/invoices/${id}`);
  assert.equal(full.body.items.length, 2);

  // đổi items sang debt của người khác → 400 và không thay đổi
  r = await api.put(`/api/invoices/${id}`, { items: [{ description: 'X', quantity: 1, unitPrice: 1, debtId: otherDebt.body.id }] });
  assert.equal(r.status, 400);
  assert.equal((await api.get(`/api/invoices/${id}`)).body.items.length, 2);
  // agency đọc được, không sửa được
  assert.equal((await h.api(U.agency.token).get(`/api/invoices/${id}`)).status, 200);
  assert.equal((await h.api(U.agency.token).put(`/api/invoices/${id}`, { status: 'unpaid' })).status, 404);
});

test('import debts: paid>0 tạo payments; dòng lỗi báo theo số dòng', async () => {
  const api = h.api(U.child.token);
  const r = await api.post('/api/debts/import', {
    rows: [
      { customerName: 'Khách Import 1', ticketAmount: '2.000.000', paid: '500.000', issueDate: '01/12/2026', flightDate: '25/12/2026', ticketCode: 'IMP1' },
      { customerName: 'Khách Import 2', ticketAmount: '1,000,000', paid: 0, issueDate: '2026-12-02' },
      { customerName: '', ticketAmount: 100 },
      { customerName: 'Sai ngày', ticketAmount: 100, issueDate: 'abc' },
    ],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.inserted, 2);
  assert.equal(r.body.failed, 2);
  assert.deepEqual(r.body.errors.map((e) => e.row), [4, 5]);
  const d = await h.pool.query("SELECT id, paid, issue_date, flight_date FROM debts WHERE ticket_code = 'IMP1'");
  assert.equal(Number(d.rows[0].paid), 500000);
  assert.equal(d.rows[0].issue_date, '2026-12-01');
  assert.equal(d.rows[0].flight_date, '2026-12-25');
  const p = await h.pool.query('SELECT amount, payment_date, method FROM payments WHERE debt_id = $1', [d.rows[0].id]);
  assert.equal(p.rows.length, 1);
  assert.equal(Number(p.rows[0].amount), 500000);
  assert.equal(p.rows[0].payment_date, '2026-12-01');
  const total = await h.pool.query("SELECT COUNT(*)::int n FROM payments p JOIN debts d ON d.id = p.debt_id WHERE d.customer_name LIKE 'Khách Import%'");
  assert.equal(total.rows[0].n, 1, 'dòng paid=0 không tạo payment');
});
