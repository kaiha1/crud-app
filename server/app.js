import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './database.js';

const scrypt = promisify(scryptCallback);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeUser = user => ({ id: user.id, name: user.name, email: user.email });
const text = value => typeof value === 'string' ? value.trim() : '';
const sessionLength = 7 * 24 * 60 * 60 * 1000;

export function createApp({ databasePath = 'data/taskroom.sqlite', secureCookies = process.env.NODE_ENV === 'production' } = {}) {
  const db = openDatabase(databasePath);
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Cross-origin HTML forms cannot supply this custom header; CORS is not enabled.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Requested-With') !== 'Taskroom') return res.status(403).json({ error: 'Request verification failed.' });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
  app.use(['/api/auth/login', '/api/auth/signup'], authLimit);
  const tokenFrom = req => req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith('session='))?.slice(8) || '';
  function createSession(req, res, userId) {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(digest(token), userId, Date.now() + sessionLength);
    const oldToken = tokenFrom(req);
    if (oldToken) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(oldToken));
    res.cookie('session', token, { httpOnly: true, sameSite: 'lax', secure: secureCookies, maxAge: sessionLength, path: '/' });
  }
  function authenticated(req, res, next) {
    const user = db.prepare('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?').get(digest(tokenFrom(req)), Date.now());
    if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.user = safeUser(user);
    next();
  }
  app.get('/api/health', (req, res) => { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); });
  app.post('/api/auth/signup', async (req, res) => {
    const name = text(req.body?.name), email = text(req.body?.email).toLowerCase(), password = req.body?.password;
    if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== 'string' || password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Enter a name (1–80 characters), valid email, and password (8–128 characters).' });
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64)).toString('hex');
    let result;
    try { result = db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name, email, `${salt}:${hash}`); }
    catch (error) { if (error.message.includes('UNIQUE constraint failed: users.email')) return res.status(409).json({ error: 'An account with this email already exists.' }); throw error; }
    const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid);
    createSession(req, res, user.id);
    res.status(201).json({ user: safeUser(user) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const email = text(req.body?.email).toLowerCase(), password = req.body?.password;
    if (typeof password !== 'string' || password.length > 128 || email.length > 254) return res.status(400).json({ error: 'Enter a valid email and password.' });
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const [salt, stored] = user?.password_hash.split(':') || ['missing-user-salt', '00'.repeat(64)];
    const hash = await scrypt(password, salt, 64);
    if (!timingSafeEqual(hash, Buffer.from(stored, 'hex')) || !user) return res.status(401).json({ error: 'Incorrect email or password.' });
    createSession(req, res, user.id);
    res.json({ user: safeUser(user) });
  });
  app.post('/api/auth/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(tokenFrom(req)));
    res.clearCookie('session', { path: '/', httpOnly: true, sameSite: 'lax', secure: secureCookies });
    res.status(204).end();
  });
  app.get('/api/auth/me', authenticated, (req, res) => res.json({ user: req.user }));
  app.use('/api/tasks', authenticated);
  app.get('/api/tasks', (req, res) => res.json({ tasks: db.prepare('SELECT id,title,description,status,created_at,updated_at FROM tasks WHERE user_id=? ORDER BY id DESC').all(req.user.id) }));
  function validateTask(body) {
    const title = text(body?.title), description = text(body?.description), status = body?.status ?? 'todo';
    if (!title || title.length > 120 || description.length > 2000 || !['todo', 'doing', 'done'].includes(status) || (body?.description != null && typeof body.description !== 'string')) return null;
    return { title, description, status };
  }
  const getTask = (id, userId) => db.prepare('SELECT id,title,description,status,created_at,updated_at FROM tasks WHERE id=? AND user_id=?').get(id, userId);
  app.post('/api/tasks', (req, res) => {
    const task = validateTask(req.body);
    if (!task) return res.status(400).json({ error: 'A title (1–120 characters), description up to 2,000 characters, and valid status are required.' });
    const result = db.prepare('INSERT INTO tasks(user_id,title,description,status) VALUES(?,?,?,?)').run(req.user.id, task.title, task.description, task.status);
    res.status(201).json({ task: getTask(result.lastInsertRowid, req.user.id) });
  });
  app.param('id', (req, res, next, id) => {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return res.status(400).json({ error: 'Invalid task ID.' });
    next();
  });
  app.get('/api/tasks/:id', (req, res) => {
    const task = getTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    res.json({ task });
  });
  app.put('/api/tasks/:id', (req, res) => {
    const task = validateTask(req.body);
    if (!task) return res.status(400).json({ error: 'Check the title, description, and status.' });
    const result = db.prepare("UPDATE tasks SET title=?,description=?,status=?,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?").run(task.title, task.description, task.status, req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Task not found.' });
    res.json({ task: getTask(req.params.id, req.user.id) });
  });
  app.delete('/api/tasks/:id', (req, res) => {
    if (!db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(req.params.id, req.user.id).changes) return res.status(404).json({ error: 'Task not found.' });
    res.status(204).end();
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url))));
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, db };
}
