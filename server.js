require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const { parseExcelFile } = require('./src/parser');
const { generateInsights } = require('./src/insights');

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(xls|xlsx)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only .xls and .xlsx files are accepted'), ok);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'admiral-internal-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 12 * 60 * 60 * 1000 } // 12h
}));

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.PASSWORD) {
    return res.status(500).json({ error: 'PASSWORD not set in environment' });
  }
  if (password === process.env.PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ authenticated: !!req.session.authenticated });
});

// ── Data ──────────────────────────────────────────────────────────────────────

app.post('/api/upload', requireAuth, upload.array('files', 20), (req, res) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: 'No files received' });
    }

    const incoming = req.files.map(f => parseExcelFile(f.buffer, f.originalname));
    const allRecords = incoming.flatMap(r => r.records);

    req.session.data = {
      records: allRecords,
      files: incoming.map(r => ({
        name: r.filename,
        type: r.type,
        count: r.records.length
      }))
    };

    res.json({
      ok: true,
      totalRecords: allRecords.length,
      files: req.session.data.files
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/data', requireAuth, (req, res) => {
  req.session.data = null;
  res.json({ ok: true });
});

app.get('/api/data', requireAuth, (req, res) => {
  if (!req.session.data) return res.json({ records: [], files: [] });
  res.json(req.session.data);
});

// ── AI Insights ───────────────────────────────────────────────────────────────

app.post('/api/insights', requireAuth, async (req, res) => {
  const records = req.session.data?.records;
  if (!records?.length) {
    return res.status(400).json({ error: 'No data loaded. Upload an Excel file first.' });
  }
  try {
    const insight = await generateInsights(records, req.body.question || null);
    res.json({ insight });
  } catch (err) {
    console.error('Insights error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Serve SPA ─────────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Admiral Insights running on http://localhost:${PORT}`);
});
