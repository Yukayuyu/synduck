import { Store } from './index.ts';
const store = new Store(process.env.DATABASE_PATH || './data/context-canvas.sqlite');
console.log('SQLite migrations 001–002 applied; domain version 0.1.0.');
store.close();
