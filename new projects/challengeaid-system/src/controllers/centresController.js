const { z } = require('zod');
const { query } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

const createCentreSchema = z.object({
  name: z.string().min(1),
  location: z.string().min(1)
});

async function listCentres(req, res, next) {
  try {
    const { rows } = await query('SELECT * FROM centres ORDER BY name');
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function createCentre(req, res, next) {
  try {
    const input = createCentreSchema.parse(req.body);
    const { rows } = await query(
      'INSERT INTO centres (name, location) VALUES ($1, $2) RETURNING *',
      [input.name, input.location]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid centre payload', 400, err.errors));
    next(err);
  }
}

module.exports = { listCentres, createCentre };
