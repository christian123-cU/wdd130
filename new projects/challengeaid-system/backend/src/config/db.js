const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD
});

pool.on('error', (err) => {
  // Idle client errors shouldn't crash the process, but they must be
  // visible — a silently dead pool is worse than a noisy log line.
  console.error('Unexpected PostgreSQL pool error', err);
});

/**
 * Run a query with a single connection from the pool.
 */
async function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run a callback inside a transaction. The callback receives a client
 * and must use it for every query so all statements share one
 * transaction. Rolls back on any thrown error.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
