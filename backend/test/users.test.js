// test/users.test.js — quản lý tài khoản: xoá có con, đặt lại mật khẩu, tạo user validate.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
before(async () => {
  await h.start();
  U = await h.seedUsers();
});
after(() => h.stop());

test('deleteUser: đại lý còn con → 400; xoá con trước rồi xoá được', async () => {
  const admin = h.api(U.admin.token);
  const r = await admin.del(`/api/users/${U.agency.id}`);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Đại lý còn 1 đại lý con, hãy xóa hoặc chuyển trước');
  // agency xoá child được (trong phạm vi)
  const grand = await h.createUser({ username: 'grand', parentId: U.child.id });
  assert.equal((await h.api(U.agency.token).del(`/api/users/${U.child.id}`)).status, 400, 'child còn con');
  assert.equal((await h.api(U.agency.token).del(`/api/users/${grand.id}`)).status, 200);
  assert.equal((await h.api(U.agency.token).del(`/api/users/${U.child.id}`)).status, 200);
  assert.equal((await admin.del(`/api/users/${U.agency.id}`)).status, 200);
  // user thường không có quyền; tự xoá → 400
  assert.equal((await h.api(U.other.token).del(`/api/users/${U.admin.id}`)).status, 403);
  assert.equal((await admin.del(`/api/users/${U.admin.id}`)).status, 400);
  const audit = await h.waitFor(async () => {
    const q = await h.pool.query("SELECT COUNT(*)::int n FROM audit_logs WHERE entity = 'user' AND action = 'delete'");
    return q.rows[0].n >= 3 ? q.rows[0].n : null;
  });
  assert.ok(audit >= 3);
});

test('password reset: đại lý cha OK, user lạ 404/403, admin OK, tự mình 400, validate', async () => {
  // dựng lại cây vì test trên đã xoá
  const agency2 = await h.createUser({ username: 'agency2', role: 'agency' });
  const kid = await h.createUser({ username: 'kid', parentId: agency2.id });

  let r = await h.api(agency2.token).post(`/api/users/${kid.id}/password`, { newPassword: 'newpass123' });
  assert.equal(r.status, 200);
  assert.ok(r.body.message);
  assert.equal((await h.api().post('/api/auth/login', { username: 'kid', password: 'newpass123' })).status, 200);
  assert.equal((await h.api().post('/api/auth/login', { username: 'kid', password: 'secret123' })).status, 401);

  r = await h.api(U.other.token).post(`/api/users/${kid.id}/password`, { newPassword: 'hacked123' });
  assert.ok([403, 404].includes(r.status));
  const stranger = await h.createUser({ username: 'stranger', role: 'agency' });
  assert.equal((await h.api(stranger.token).post(`/api/users/${kid.id}/password`, { newPassword: 'hacked123' })).status, 404);

  assert.equal((await h.api(U.admin.token).post(`/api/users/${kid.id}/password`, { newPassword: 'admin_set' })).status, 200);
  assert.equal((await h.api(agency2.token).post(`/api/users/${agency2.id}/password`, { newPassword: 'selfself' })).status, 400);
  assert.equal((await h.api(agency2.token).post(`/api/users/${kid.id}/password`, { newPassword: '123' })).status, 400);
  assert.equal((await h.api(agency2.token).post(`/api/users/${kid.id}/password`, {})).status, 400);
});

test('createUser validate + GET /api/users outstanding gộp 4 loại', async () => {
  const agency3 = await h.createUser({ username: 'agency3', role: 'agency' });
  const api = h.api(agency3.token);
  assert.equal((await api.post('/api/users', { username: 'ab', password: 'secret123' })).status, 400);
  assert.equal((await api.post('/api/users', { username: 'a'.repeat(51), password: 'secret123' })).status, 400);
  assert.equal((await api.post('/api/users', { username: 'okuser', password: '12345' })).status, 400);
  const c = await api.post('/api/users', { username: 'okuser', password: 'secret123', role: 'admin' });
  assert.equal(c.status, 201);
  assert.equal(c.body.role, 'user', 'agency không gán role');
  assert.equal(c.body.parent_id, agency3.id);
  assert.deepEqual(c.body.features, { fareWatch: false });
  assert.equal((await api.post('/api/users', { username: 'okuser', password: 'secret123' })).status, 409);

  const tok = (await h.api().post('/api/auth/login', { username: 'okuser', password: 'secret123' })).body.token;
  const kidApi = h.api(tok);
  await kidApi.post('/api/debts', { customerName: 'K', ticketAmount: 100, paid: 10 });
  await kidApi.post('/api/passports', { customerName: 'K', serviceDate: '2026-01-01', totalAmount: 200, paidAmount: 50 });
  await kidApi.post('/api/train-tickets', { customerName: 'K', ticketAmount: 300 });
  await kidApi.post('/api/tours', { customerName: 'K', sellAmount: 400, paid: 100 });
  const list = await api.get('/api/users');
  const row = list.body.find((u) => u.username === 'okuser');
  assert.equal(Number(row.outstanding), 90 + 150 + 300 + 300);
});
