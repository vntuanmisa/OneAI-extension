// Express API for Vercel
// - Lưu và truy xuất dữ liệu JSON theo {employeeCode}/{YYYY-MM}.json dưới /tmp
// - Xác thực bằng header X-Auth-Token so với biến môi trường API_SECRET_KEY

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

// Middlewares
app.use(express.json({ limit: '1mb' }));

// Helpers
const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;
const BASE_DIR = process.env.STORAGE_DIR
  ? path.resolve(process.env.STORAGE_DIR)
  : path.join('/tmp', 'oneai_data');

function ensureAuth(req, res, next) {
  const token = req.header('X-Auth-Token');
  const secret = process.env.API_SECRET_KEY;
  if (!secret || !token || token !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function getFilePath(employeeCode, period) {
  const safeEmp = String(employeeCode || '').trim();
  if (!safeEmp) return null;
  return path.join(BASE_DIR, safeEmp, `${period}.json`);
}

function validatePeriod(period) {
  return typeof period === 'string' && PERIOD_REGEX.test(period);
}

// Health check
app.get('/api/health', (_req, res) => res.status(200).json({ ok: true }));

// Routes
// GET /api/data/:employeeCode?period=YYYY-MM
app.get('/api/data/:employeeCode', ensureAuth, async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const { period } = req.query;
    if (!validatePeriod(period)) {
      return res.status(400).json({ error: 'Invalid period. Expected YYYY-MM.' });
    }
    const filePath = getFilePath(employeeCode, period);
    if (!filePath) return res.status(400).json({ error: 'Invalid employeeCode.' });

    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch (_) {
      return res.status(404).json({});
    }

    try {
      const raw = await fs.promises.readFile(filePath, 'utf-8');
      const data = raw ? JSON.parse(raw) : {};
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to read JSON file.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/data/:employeeCode?period=YYYY-MM
// Body: JSON to overwrite
app.post('/api/data/:employeeCode', ensureAuth, async (req, res) => {
  try {
    const { employeeCode } = req.params;
    const { period } = req.query;
    if (!validatePeriod(period)) {
      return res.status(400).json({ error: 'Invalid period. Expected YYYY-MM.' });
    }
    const filePath = getFilePath(employeeCode, period);
    if (!filePath) return res.status(400).json({ error: 'Invalid employeeCode.' });

    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });

    // Ensure body is an object; if not, still stringify what is passed
    const payload = req.body == null ? {} : req.body;
    const json = JSON.stringify(payload, null, 2);
    await fs.promises.writeFile(filePath, json, 'utf-8');
    return res.status(200).json({ status: 'success' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Export Express app directly for @vercel/node
module.exports = app;


