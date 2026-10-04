import { Store } from './index.ts';
const store = new Store(process.env.DATABASE_PATH || './data/context-canvas.sqlite');
console.log('SQLite migration 001 applied; schema version 0.1.0.');
store.close();
