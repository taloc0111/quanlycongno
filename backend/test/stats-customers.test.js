// test/stats-customers.test.js — import vé tàu/tour, stats (todo/byType/counts), chi tiết khách, audit, DATE string.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { todayLocal, addDays } = require('../utils/dates');

let U;
let api;
const today = todayLocal();
const tomorrow = addDays(today, 1);

before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
});
after(() => h.stop());

test('import train-tickets / tours: paid>0 tạo payments, validate dòng', async () => {
  let r = await api.post('/api/train-tickets/import', {
    rows: [
      { customerName: 'Khách Tàu', phoneNumber: '0911', trainNo: 'SE7', route: 'Hà Nội - Vinh', seatClass: 'Giường nằm', departDate: '20/12/2026', issueDate: '01/12/2026', ticketAmount: '800.000', costAmount: '700.000', paid: '300.000', notes: 'n', ticketSource: 'DSVN' },
      { customerName: 'Tàu lỗi', ticketAmount: 'abc' },
    ],
  });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.inserted, r.body.failed], [1, 1]);
  let p = await h.pool.query("SELECT p.amount FROM payments p JOIN train_tickets t ON t.id = p.train_ticket_id WHERE t.train_no = 'SE7'");
  assert.equal(Number(p.rows[0].amount), 300000);

  r = await api.post('/api/tours/import', {
    rows: [
      { customerName: 'Khách Tour', tourName: 'Đà Lạt 3N2Đ', departDate: '10/12/2026', returnDate: '12/12/2026', pax: 4, issueDate: '01/12/2026', sellAmount: '12.000.000', costAmount: '10.000.000', paid: '5.000.000', source: 'Đối tác X' },
      { customerName: 'Tour lỗi', sellAmount: 100, pax: 'nhiều' },
      { customerName: 'Tour lỗi 2', sellAmount: 100, departDate: '99/99/2026' },
    ],
  });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.inserted, r.body.failed], [1, 2]);
  const t = await h.pool.query("SELECT id, pax, depart_date, return_date, paid FROM tours WHERE tour_name = 'Đà Lạt 3N2Đ'");
  assert.equal(t.rows[0].pax, 4);
  assert.equal(t.rows[0].depart_date, '2026-12-10');
  assert.equal(t.rows[0].return_date, '2026-12-12');
  p = await h.pool.query('SELECT amount FROM payments WHERE tour_id = $1', [t.rows[0].id]);
  assert.equal(Number(p.rows[0].amount), 5000000);
  assert.equal((await api.post('/api/tours/import', { rows: [] })).status, 400);
  assert.equal((await api.post('/api/train-tickets/import', { rows: [{ customerName: '' }] })).status, 400);
});

test('stats: counts/byType/monthly 12 tháng/todo', async () => {
  // dữ liệu cho todo
  await api.post('/api/debts', { customerName: 'Bay mai', phoneNumber: '0999', ticketAmount: 1000000, flightDate: tomorrow, route: 'SGN-HAN', airline: 'VN', ticketCode: 'TMR1' });
  await api.post('/api/debts', { customerName: 'Sắp hạn', ticketAmount: 500000, paid: 100000, dueDate: addDays(today, 3) });
  await api.post('/api/debts', { customerName: 'Quá hạn', ticketAmount: 700000, dueDate: addDays(today, -2) });
  await api.post('/api/debts', { customerName: 'Đã trả hết', ticketAmount: 100000, paid: 100000, dueDate: addDays(today, -5) });
  await api.post('/api/passports', { customerName: 'HC sắp hạn', serviceDate: today, totalAmount: 300000, dueDate: addDays(today, 7) });
  await api.post('/api/tours', { customerName: 'Tour quá hạn', sellAmount: 900000, paid: 400000, dueDate: addDays(today, -1) });
  // canh vé đạt giá (child chưa bật feature → chèn thẳng DB; stats vẫn phải thấy)
  await h.pool.query(
    `INSERT INTO ticket_watches (user_id, customer_name, route, depart_date, target_price, last_price, status)
     VALUES ($1,'Hit','SGN-HAN',$2,1000000,900000,'watching'), ($1,'Miss','SGN-HAN',$2,1000000,1100000,'watching'),
            ($1,'Booked','SGN-HAN',$2,1000000,900000,'booked'), ($1,'NoTarget','SGN-HAN',$2,0,900000,'watching')`,
    [U.child.id, addDays(today, 15)]
  );

  const r = await api.get('/api/stats');
  assert.equal(r.status, 200);
  const s = r.body;
  // counts: 4 debts + 1 passport + 1 train (import) + 2 tours (import + quá hạn)
  // v3.1: counts.cancelled (số dịch vụ đã huỷ)
  assert.deepEqual(s.counts, { debts: 4, passports: 1, trainTickets: 1, tours: 2, customers: s.counts.customers, cancelled: 0 });
  assert.ok(s.counts.customers >= 7);
  assert.equal(s.byType.debts.count, 4);
  assert.equal(s.byType.debts.amount, 1000000 + 500000 + 700000 + 100000);
  assert.equal(s.byType.debts.paid, 200000);
  assert.equal(s.byType.trainTickets.amount, 800000);
  assert.equal(s.byType.trainTickets.cost, 700000);
  assert.equal(s.byType.tours.amount, 12000000 + 900000);
  assert.equal(s.byType.passports.paid, 0);
  assert.equal(s.totalAmount, s.byType.debts.amount + s.byType.passports.amount + s.byType.trainTickets.amount + s.byType.tours.amount);
  assert.equal(s.overdue, 700000 + 500000, 'quá hạn: debt 700k + tour (900k-400k)');
  assert.ok(Array.isArray(s.monthly));
  assert.ok(s.monthly.every((m) => /^\d{4}-\d{2}$/.test(m.month)));
  assert.ok(Array.isArray(s.topDebtors));

  // todo
  assert.equal(s.todo.flightsTomorrow.length, 1);
  const f = s.todo.flightsTomorrow[0];
  assert.deepEqual(Object.keys(f).sort(), ['airline', 'checked_in', 'customer_name', 'flight_date', 'id', 'phone_number', 'route', 'ticket_code'].sort());
  assert.equal(f.flight_date, tomorrow);
  assert.equal(f.checked_in, false);

  assert.deepEqual(s.todo.dueSoon.map((d) => [d.type, d.customer_name, d.outstanding]).sort(), [['debt', 'Sắp hạn', 400000], ['passport', 'HC sắp hạn', 300000]].sort());
  assert.ok(s.todo.dueSoon.every((d) => 'phone_number' in d && 'due_date' in d && 'id' in d));
  assert.deepEqual(s.todo.overdue.map((d) => [d.type, d.outstanding]).sort(), [['debt', 700000], ['tour', 500000]].sort());

  assert.equal(s.todo.fareHits.length, 1);
  assert.deepEqual(s.todo.fareHits[0], { id: s.todo.fareHits[0].id, customer_name: 'Hit', route: 'SGN-HAN', depart_date: addDays(today, 15), last_price: 900000, target_price: 1000000 });

  // agency thấy stats của child, other thì không
  const ag = await h.api(U.agency.token).get(`/api/stats?agencyId=${U.child.id}`);
  assert.equal(ag.body.counts.debts, 4);
  assert.equal((await h.api(U.other.token).get('/api/stats')).body.counts.debts, 0);
});

test('customer detail: totals + payments gắn type/target_label + lọc from/to + scope', async () => {
  const c = await api.post('/api/customers', { name: 'Khách Chi Tiết', phone: '0777' });
  assert.equal(c.status, 201);
  const cid = c.body.id;
  const d = await api.post('/api/debts', { customerName: 'Khách Chi Tiết', phoneNumber: '0777', ticketCode: 'DET1', ticketAmount: 1000000, costAmount: 800000, paid: 300000, issueDate: '2026-10-05' });
  assert.equal(d.body.customer_id, cid, 'upsert gộp theo tên+SĐT');
  const ps = await api.post('/api/passports', { customerName: 'Khách Chi Tiết', phoneNumber: '0777', passportNumber: 'PDET', serviceDate: '2026-11-05', totalAmount: 500000, costAmount: 400000, paidAmount: 500000 });
  const tr = await api.post('/api/train-tickets', { customerName: 'Khách Chi Tiết', phoneNumber: '0777', trainNo: 'SE1', ticketAmount: 200000, issueDate: '2026-11-20' });
  const tu = await api.post('/api/tours', { customerName: 'Khách Chi Tiết', phoneNumber: '0777', tourName: 'Huế', sellAmount: 3000000, costAmount: 2500000, paid: 1000000, issueDate: '2026-12-01' });
  await api.post('/api/payments', { trainTicketId: tr.body.id, amount: 50000, paymentDate: '2026-11-21' });

  let r = await api.get(`/api/customers/${cid}/detail`);
  assert.equal(r.status, 200);
  assert.equal(r.body.customer.id, cid);
  assert.equal(r.body.debts.length, 1);
  assert.equal(r.body.passports.length, 1);
  assert.equal(r.body.trainTickets.length, 1);
  assert.equal(r.body.tours.length, 1);
  assert.deepEqual(r.body.totals, { sold: 4700000, cost: 3700000, paid: 1850000, outstanding: 2850000 });
  assert.equal(r.body.payments.length, 4);
  const byType = Object.fromEntries(r.body.payments.map((p) => [p.type, p.target_label]));
  assert.deepEqual(byType, { debt: 'DET1', passport: 'PDET', train: 'SE1', tour: 'Huế' });

  // lọc tháng 11
  r = await api.get(`/api/customers/${cid}/detail?from=2026-11-01&to=2026-11-30`);
  assert.equal(r.body.debts.length, 0);
  assert.equal(r.body.passports.length, 1);
  assert.equal(r.body.trainTickets.length, 1);
  assert.equal(r.body.tours.length, 0);
  assert.deepEqual(r.body.totals, { sold: 700000, cost: 400000, paid: 550000, outstanding: 150000 });
  assert.equal(r.body.payments.length, 2);
  assert.equal((await api.get(`/api/customers/${cid}/detail?from=bad`)).status, 400);

  // scope: agency xem được, other 404
  assert.equal((await h.api(U.agency.token).get(`/api/customers/${cid}/detail`)).status, 200);
  assert.equal((await h.api(U.other.token).get(`/api/customers/${cid}/detail`)).status, 404);

  // GET /customers outstanding gộp 4 loại
  const list = await api.get('/api/customers');
  assert.equal(Number(list.body.find((x) => x.id === cid).outstanding), 2850000);
  assert.equal(d.body.issue_date, '2026-10-05');
  assert.equal(ps.body.service_date, '2026-11-05');
  assert.equal(tu.body.issue_date, '2026-12-01');
});

test('GET /api/audit: scoped, newest first, lọc userId', async () => {
  const rows = await h.waitFor(async () => {
    const r = await h.api(U.agency.token).get('/api/audit?limit=200');
    return r.body.rows.length > 5 ? r.body.rows : null;
  });
  assert.ok(rows.every((r) => [U.agency.id, U.child.id].includes(r.user_id)));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].id >= rows[i].id, 'mới nhất trước');
  const only = await h.api(U.agency.token).get(`/api/audit?userId=${U.child.id}&limit=5`);
  assert.equal(only.body.rows.length, 5);
  assert.ok(only.body.rows.every((r) => r.user_id === U.child.id));
  const none = await h.api(U.other.token).get(`/api/audit?userId=${U.child.id}`);
  assert.deepEqual(none.body, { rows: [] });
  assert.equal((await h.api(U.other.token).get('/api/audit?limit=abc')).status, 400);
  const sample = rows.find((r) => r.entity === 'debt' && r.action === 'create');
  assert.ok(sample && sample.summary && sample.username === 'child');
});

test('deposits: validate + balance agencyPayments gộp 4 loại', async () => {
  const dep = await api.post('/api/deposits', { amount: 1000000, depositDate: '2026-11-01', method: 'cash' });
  assert.equal(dep.status, 201);
  assert.equal(dep.body.deposit_date, '2026-11-01');
  assert.equal((await api.post('/api/deposits', { amount: 0 })).status, 400);
  assert.equal((await api.post('/api/deposits', { amount: 'x' })).status, 400);
  assert.equal((await api.post('/api/deposits', { amount: -500000 })).status, 201, 'âm = nợ cũ, cho phép');

  const tu = await api.post('/api/tours', { customerName: 'Khách Agency', tourName: 'Sapa', sellAmount: 2000000, paid: 600000, paymentTarget: 'agency' });
  const tr = await api.post('/api/train-tickets', { customerName: 'Khách Agency', trainNo: 'SE3', ticketAmount: 300000, paid: 100000, paymentTarget: 'agency' });
  assert.equal(tu.status, 201);
  assert.equal(tr.status, 201);
  const bal = await api.get('/api/deposits/balance');
  assert.equal(bal.status, 200);
  assert.equal(bal.body.totalCustomerToAgency, 700000);
  assert.equal(bal.body.totalDeposited, 500000);
  assert.equal(bal.body.balance, 1200000);
  const labels = bal.body.agencyPayments.map((p) => [p.type, p.customer_name, p.ticket_code]).sort();
  assert.deepEqual(labels, [['tour', 'Khách Agency', 'Sapa'], ['train', 'Khách Agency', 'SE3']].sort());
});
