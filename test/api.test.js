import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';

let server, db, base;
const directory = mkdtempSync(join(tmpdir(), 'taskroom-test-'));
const databasePath = join(directory, 'test.sqlite');
before(async () => {
  const setup = createApp({ databasePath, secureCookies: false }); db = setup.db;
  server = setup.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); rmSync(directory, { recursive: true }); });
async function request(path, { method = 'GET', body, cookie, verify = true } = {}) {
  const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(verify ? { 'X-Requested-With': 'Taskroom' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = response.status === 204 ? null : await response.json();
  return { status: response.status, data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const signup = (email, name = 'Alex') => request('/api/auth/signup', { method: 'POST', body: { name, email, password: 'correct-horse-123' } });

test('health and frontend are served with security headers', async () => {
  assert.equal((await request('/api/health')).data.status, 'ok');
  const response = await fetch(base);
  assert.equal(response.status, 200); assert.match(await response.text(), /Taskroom/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
});
test('authentication validates input, hashes passwords, protects cookies, and rejects duplicates', async () => {
  assert.equal((await request('/api/auth/signup', { method: 'POST', body: { name: '', email: 'bad', password: 'short' } })).status, 400);
  const result = await signup('Alex@example.com'); assert.equal(result.status, 201);
  assert.equal(result.data.user.email, 'alex@example.com'); assert.equal(result.data.user.password_hash, undefined);
  assert.match(result.headers.get('set-cookie'), /HttpOnly/); assert.match(result.headers.get('set-cookie'), /SameSite=Lax/);
  const stored = db.prepare('SELECT password_hash FROM users WHERE email=?').get('alex@example.com');
  assert.notEqual(stored.password_hash, 'correct-horse-123'); assert.match(stored.password_hash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal((await signup('ALEX@EXAMPLE.COM')).status, 409);
  assert.equal((await request('/api/auth/me', { cookie: result.cookie })).data.user.name, 'Alex');
});
test('login rejects invalid credentials, rotates sessions, and logout revokes access', async () => {
  const account = await signup('login@example.com');
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'login@example.com', password: 'wrong' } })).status, 401);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'missing@example.com', password: 'wrong' } })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', cookie: account.cookie, body: { email: 'LOGIN@example.com', password: 'correct-horse-123' } });
  assert.equal(login.status, 200); assert.notEqual(login.cookie, account.cookie);
  assert.equal((await request('/api/auth/me', { cookie: account.cookie })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', cookie: login.cookie })).status, 204);
  assert.equal((await request('/api/tasks', { cookie: login.cookie })).status, 401);
});
test('task CRUD enforces ownership and validation and preserves literal text', async () => {
  const alice = await signup('owner@example.com'), bob = await signup('other@example.com');
  assert.equal((await request('/api/tasks')).status, 401);
  for (const body of [{ title: ' ' }, { title: 'x'.repeat(121) }, { title: 'Task', status: 'invalid' }, { title: 'Task', description: 'x'.repeat(2001) }]) {
    assert.equal((await request('/api/tasks', { method: 'POST', cookie: alice.cookie, body })).status, 400);
  }
  const created = await request('/api/tasks', { method: 'POST', cookie: alice.cookie, body: { title: '<script>alert(1)</script>', description: "Robert'); DROP TABLE users;--" } });
  assert.equal(created.status, 201); const id = created.data.task.id;
  assert.equal((await request(`/api/tasks/${id}`, { cookie: alice.cookie })).data.task.title, '<script>alert(1)</script>');
  assert.equal((await request('/api/tasks', { cookie: bob.cookie })).data.tasks.length, 0);
  for (const method of ['GET', 'PUT', 'DELETE']) assert.equal((await request(`/api/tasks/${id}`, { method, cookie: bob.cookie, ...(method === 'PUT' ? { body: { title: 'Stolen' } } : {}) })).status, 404);
  const updated = await request(`/api/tasks/${id}`, { method: 'PUT', cookie: alice.cookie, body: { title: 'Updated', description: 'Details', status: 'done' } });
  assert.equal(updated.data.task.status, 'done'); assert.equal(updated.data.task.title, 'Updated');
  assert.equal((await request('/api/tasks/bad', { cookie: alice.cookie })).status, 400);
  assert.equal((await request(`/api/tasks/${id}`, { method: 'DELETE', cookie: alice.cookie })).status, 204);
  assert.equal((await request(`/api/tasks/${id}`, { cookie: alice.cookie })).status, 404);
});
test('CSRF protection, expired sessions, malformed JSON and size limits', async () => {
  assert.equal((await request('/api/auth/logout', { method: 'POST', verify: false })).status, 403);
  const account = await signup('expired@example.com');
  db.prepare('UPDATE sessions SET expires_at=0 WHERE user_id=?').run(account.data.user.id);
  assert.equal((await request('/api/auth/me', { cookie: account.cookie })).status, 401);
  const invalid = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'Taskroom' }, body: '{bad' }); assert.equal(invalid.status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { password: 'x'.repeat(40000) } })).status, 413);
});
test('database persists accounts and tasks across a second database connection', async () => {
  const account = await signup('persist@example.com');
  await request('/api/tasks', { method: 'POST', cookie: account.cookie, body: { title: 'Persist me' } });
  const second = createApp({ databasePath });
  try { assert.equal(second.db.prepare('SELECT title FROM tasks WHERE user_id=?').get(account.data.user.id).title, 'Persist me'); }
  finally { second.db.close(); }
});
