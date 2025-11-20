import pkg from 'pg';
const { Pool } = pkg;

// --- POOL PARA ESCRITA ---
console.log('DB Host:', process.env.DB_HOST);
console.log('DB User:', process.env.DB_USER);
console.log('DB Name:', process.env.DB_NAME);
console.log('DB Port Write:', process.env.DB_PORT_WRITE);
console.log('DB Port Read:', process.env.DB_PORT_READ);
console.log('DB PWD:' + (process.env.DB_PASSWORD));
export const poolWrite = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT_WRITE,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// --- POOL PARA LEITURA ---
export const poolRead = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT_READ,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});
