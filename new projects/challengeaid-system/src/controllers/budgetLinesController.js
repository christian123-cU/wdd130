const { z } = require('zod');
const { query } = require('../config/db');
const { AppError } = require('../middleware/errorHandler');

const createSchema = z.object({
  name: z.string().min(1),
  centreId: z.string().uuid(),
  allocatedAmount: z.number().positive()
});

async function listBudgetLines(req, res, next) {
  try {
    const { centreId } = req.query;
    const { rows } = centreId
      ? await query('SELECT * FROM budget_lines WHERE centre_id = $1 ORDER BY name', [centreId])
      : await query('SELECT * FROM budget_lines ORDER BY name');
    res.json(
      rows.map((r) => ({
        ...r,
        remaining: Number(r.allocated_amount) - Number(r.spent_to_date)
      }))
    );
  } catch (err) {
    next(err);
  }
}

async function createBudgetLine(req, res, next) {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await query(
      'INSERT INTO budget_lines (name, centre_id, allocated_amount) VALUES ($1, $2, $3) RETURNING *',
      [input.name, input.centreId, input.allocatedAmount]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.name === 'ZodError') return next(new AppError('Invalid budget line payload', 400, err.errors));
    next(err);
  }
}

module.exports = { listBudgetLines, createBudgetLine };
