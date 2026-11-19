const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function createDb(databaseUrl) {
  // Neon dung chung chi hop le -> kiem tra day du (verify-full), tranh canh bao cua pg
  const url = databaseUrl.replace(/sslmode=(require|prefer|verify-ca)/, 'sslmode=verify-full');
  const pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30000 });
  pool.on('error', (err) => console.error('[DB] loi pool:', err.message));

  return {
    pool,
    query: (text, params) => pool.query(text, params),
    async one(text, params) {
      const r = await pool.query(text, params);
      return r.rows[0] || null;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async migrate({ seed = true } = {}) {
      const dir = path.join(__dirname, '..', 'db');
      await pool.query(fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8'));
      if (seed) await pool.query(fs.readFileSync(path.join(dir, 'seed.sql'), 'utf8'));
    },
    end: () => pool.end(),
  };
}

module.exports = { createDb };
