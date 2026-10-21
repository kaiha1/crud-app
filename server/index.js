import { createApp } from './app.js';
const { app, db } = createApp({ databasePath: process.env.DATABASE_PATH || 'data/taskroom.sqlite' });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Taskroom running on port ${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
