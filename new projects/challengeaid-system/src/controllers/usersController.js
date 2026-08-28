const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query, withTransaction } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/auditLog');

const ROLES = ['staff', 'finance', 'director', 'trustee', 'admin'];
const TRUSTEES_REQUIRED = 4;

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(ROLES),
  centreId: z.string().uuid().nullable().optional(),
  contact: z.string().nullable().optional()
});

async function listUsers(req, res, next) {
  try {
    const { rows } = await query(
      'SELECT id, name, email, role, centre_id, contact, is_active, created_at FROM users ORDER BY created_at'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function createUser(req, res, next) {
  try {
    const input = createUserSchema.parse(req.body);

    await withTransaction(async (client) => {
      if (input.role === 'trustee') {
        const { rows } = await client.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role = 'trustee' AND is_active = true`
        );
        if (rows[0].count >= TRUSTEES_REQUIRED) {
          throw new AppError(
            `The design fixes the board at ${TRUSTEES_REQUIRED} trustees; deactivate one before adding another`,
            409
          );
        }
      }

      const passwordHash = await bcrypt.hash(input.password, 10);
      const { rows } = await client.query(
        `INSERT INTO users (name, email, password_hash, role, centre_id, contact)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, email, role, centre_id, contact, is_active, created_at`,
        [input.name, input.email, passwordHash, input.role, input.centreId || null, input.contact || null]
      );

      await recordAudit(client, {
        actorId: req.user.id,
        action: 'user.created',
        details: { newUserId: rows[0].id, role: input.role }
      });

      res.status(201).json(rows[0]);
    });
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid user payload', 400, err.errors));
    next(err);
  }
}

async function deactivateUser(req, res, next) {
  try {
    const { id } = req.params;
    await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id]);
      const user = rows[0];
      if (!user) throw new AppError('User not found', 404);

      if (user.role === 'trustee') {
        const { rows: activeTrustees } = await client.query(
          `SELECT COUNT(*)::int AS count FROM users WHERE role = 'trustee' AND is_active = true`
        );
        if (activeTrustees[0].count <= TRUSTEES_REQUIRED && req.query.override !== 'true') {
          throw new AppError(
            `Deactivating this trustee would drop the board below ${TRUSTEES_REQUIRED}. ` +
              `Pass ?override=true to confirm this is intentional (e.g. a resignation pending replacement).`,
            409
          );
        }
      }

      await client.query('UPDATE users SET is_active = false WHERE id = $1', [id]);
      await recordAudit(client, { actorId: req.user.id, action: 'user.deactivated', details: { userId: id } });
      res.json({ id, isActive: false });
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listUsers, createUser, deactivateUser };
