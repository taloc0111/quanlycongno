// test/auth-features.test.js — đăng nhập, profile, cờ tính năng Canh vé + gate.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
before(async () => {
  await h.start();
  U = await h.seedUsers();
});
after(() => h.stop());

test('login trả features; profile đủ field + features resolve', async () => {
  const r = await h.api().post('/api/auth/login', { username: 'child', password: h.TEST_PASSWORD });
  assert.equal(r.status, 200);
  assert.ok(r.body.token);
  assert.deepEqual(r.body.features, { fareWatch: false });

  const p = await h.api(r.body.token).get('/api/auth/profile');
  assert.equal(p.status, 200);
  for (const k of ['id', 'username', 'full_name', 'email', 'role', 'parent_id', 'trial_ends_at', 'created_at', 'features']) {
    assert.ok(k in p.body, `thiếu field ${k}`);
  }
  assert.equal(p.body.parent_id, U.agency.id);
  assert.deepEqual(p.body.features, { fareWatch: false });

  const a = await h.api(U.admin.token).get('/api/auth/profile');
  assert.deepEqual(a.body.features, { fareWatch: true }, 'admin luôn bật');
});

test('login sai → 401; token của user đã xoá → 401; không token → 401', async () => {
  const bad = await h.api().post('/api/auth/login', { username: 'child', password: 'wrong' });
  assert.equal(bad.status, 401);
  const ghost = await h.createUser({ username: 'ghost' });
  await h.pool.query('DELETE FROM users WHERE id = $1', [ghost.id]);
  const r = await h.api(ghost.token).get('/api/debts');
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'Tài khoản không tồn tại');
  assert.equal((await h.api().get('/api/debts')).status, 401);
});

test('trial hết hạn theo DB → 403 trialExpired', async () => {
  const expired = await h.createUser({ username: 'expired', trialEndsAt: new Date(Date.now() - 1000).toISOString() });
  const r = await h.api(expired.token).get('/api/debts');
  assert.equal(r.status, 403);
  assert.equal(r.body.trialExpired, true);
});

test('register: validate username/password; response có features', async () => {
  assert.equal((await h.api().post('/api/auth/register', { username: 'ab', password: h.TEST_PASSWORD })).status, 400);
  assert.equal((await h.api().post('/api/auth/register', { username: 'newbie', password: '123' })).status, 400);
  const ok = await h.api().post('/api/auth/register', { username: 'newbie', password: h.TEST_PASSWORD });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.features, { fareWatch: false });
  assert.ok(ok.body.trialEndsAt);
});

test('feature gate: child 403 trên /ticket-watches và /fares tới khi admin bật; agency không bật được', async () => {
  const child = h.api(U.child.token);
  let r = await child.get('/api/ticket-watches');
  assert.equal(r.status, 403);
  assert.equal(r.body.featureDisabled, 'fareWatch');
  assert.equal(r.body.error, 'Tính năng Canh vé chưa được bật cho tài khoản này');
  r = await child.post('/api/fares/quote', { route: 'SGN-HAN', date: '2099-01-01' });
  assert.equal(r.status, 403);

  // agency (cha) không được bật
  r = await h.api(U.agency.token).put(`/api/users/${U.child.id}/features`, { fareWatch: true });
  assert.equal(r.status, 403);
  r = await child.get('/api/ticket-watches');
  assert.equal(r.status, 403, 'vẫn bị chặn');

  // admin bật → child vào được ngay (không cần login lại)
  r = await h.api(U.admin.token).put(`/api/users/${U.child.id}/features`, { fareWatch: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { id: U.child.id, username: 'child', features: { fareWatch: true } });
  r = await child.get('/api/ticket-watches');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, []);

  // GET /api/users trả features
  const list = await h.api(U.admin.token).get('/api/users');
  assert.equal(list.status, 200);
  const row = list.body.find((u) => u.id === U.child.id);
  assert.deepEqual(row.features, { fareWatch: true });
  assert.ok('outstanding' in row);

  // tắt lại
  r = await h.api(U.admin.token).put(`/api/users/${U.child.id}/features`, { fareWatch: false });
  assert.deepEqual(r.body.features, { fareWatch: false });
  assert.equal((await child.get('/api/ticket-watches')).status, 403);

  // admin luôn vào được; body rỗng → 400; user không tồn tại → 404
  assert.equal((await h.api(U.admin.token).get('/api/ticket-watches')).status, 200);
  assert.equal((await h.api(U.admin.token).put(`/api/users/${U.child.id}/features`, {})).status, 400);
  assert.equal((await h.api(U.admin.token).put('/api/users/99999/features', { fareWatch: true })).status, 404);
});

test('audit: login ghi dòng action=login', async () => {
  await h.api().post('/api/auth/login', { username: 'other', password: h.TEST_PASSWORD });
  const rows = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT * FROM audit_logs WHERE action = 'login' AND user_id = $1", [U.other.id]);
    return r.rows.length ? r.rows : null;
  });
  assert.equal(rows[0].entity, 'user');
  assert.equal(rows[0].username, 'other');
});
