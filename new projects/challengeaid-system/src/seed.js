require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./config/db');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: centreRows } = await client.query(
      `INSERT INTO centres (name, location) VALUES
         ('Mathare SOH', 'Kenya'),
         ('Kibera SOH', 'Kenya')
       ON CONFLICT (name, location) DO UPDATE SET name = EXCLUDED.name
       RETURNING id, name`
    );
    const mathare = centreRows.find((c) => c.name === 'Mathare SOH');

    const { rows: blRows } = await client.query(
      `INSERT INTO budget_lines (name, centre_id, allocated_amount) VALUES
         ('Coach Fees Q1', $1, 200000),
         ('Foodstuffs Q1', $1, 300000)
       RETURNING id, name`,
      [mathare.id]
    );

    const seedUsers = [
      { name: 'Admin User', email: process.env.SEED_ADMIN_EMAIL || 'admin@challengeaid.org', role: 'admin' },
      { name: 'Finance Officer', email: 'finance@challengeaid.org', role: 'finance' },
      { name: 'Programme Director', email: 'director@challengeaid.org', role: 'director' },
      { name: 'Staff Member', email: 'staff@challengeaid.org', role: 'staff' },
      { name: 'Trustee One', email: 'trustee1@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Two', email: 'trustee2@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Three', email: 'trustee3@challengeaid.org', role: 'trustee' },
      { name: 'Trustee Four', email: 'trustee4@challengeaid.org', role: 'trustee' }
    ];

    const defaultPassword = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    for (const u of seedUsers) {
      await client.query(
        `INSERT INTO users (name, email, password_hash, role, centre_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO NOTHING`,
        [u.name, u.email, passwordHash, u.role, mathare.id]
      );
    }

    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`Centres: ${centreRows.map((c) => c.name).join(', ')}`);
    console.log(`Budget lines: ${blRows.map((b) => b.name).join(', ')}`);
    console.log(`Users seeded with password: ${defaultPassword} (change immediately)`);
    seedUsers.forEach((u) => console.log(`  - ${u.role}: ${u.email}`));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
