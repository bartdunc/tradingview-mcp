require('dotenv').config();

const path = require('path');
const express = require('express');
const db = require('./src/db');
const { scoreLead } = require('./src/scoring');
const { notifyHotLead } = require('./src/mailer');

const app = express();
const PORT = process.env.PORT || 3300;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';
const HOT_LEAD_THRESHOLD = Number(process.env.HOT_LEAD_THRESHOLD) || 75;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ success: false, error: 'unauthorized' });
  }
  next();
}

const REQUIRED_FIELDS = ['company_name', 'contact_name', 'email'];

const insertLead = db.prepare(`
  INSERT INTO leads (
    company_name, contact_name, email, phone, role,
    facility_type, property_ownership, address, city, state, zip,
    roof_land_sqft, monthly_bill_usd, utility_provider,
    interest, backup_power_priority, timeline, budget_range, source, notes,
    score, grade, score_breakdown
  ) VALUES (
    @company_name, @contact_name, @email, @phone, @role,
    @facility_type, @property_ownership, @address, @city, @state, @zip,
    @roof_land_sqft, @monthly_bill_usd, @utility_provider,
    @interest, @backup_power_priority, @timeline, @budget_range, @source, @notes,
    @score, @grade, @score_breakdown
  )
`);

app.post('/api/leads', async (req, res) => {
  const body = req.body || {};

  const missing = REQUIRED_FIELDS.filter((f) => !body[f]);
  if (missing.length) {
    return res.status(400).json({ success: false, error: `missing fields: ${missing.join(', ')}` });
  }

  const lead = {
    company_name: body.company_name,
    contact_name: body.contact_name,
    email: body.email,
    phone: body.phone || null,
    role: body.role || null,
    facility_type: body.facility_type || null,
    property_ownership: body.property_ownership || null,
    address: body.address || null,
    city: body.city || null,
    state: body.state || null,
    zip: body.zip || null,
    roof_land_sqft: Number(body.roof_land_sqft) || null,
    monthly_bill_usd: Number(body.monthly_bill_usd) || null,
    utility_provider: body.utility_provider || null,
    interest: body.interest || null,
    backup_power_priority: body.backup_power_priority || null,
    timeline: body.timeline || null,
    budget_range: body.budget_range || null,
    source: body.source || 'website',
    notes: body.notes || null,
  };

  const { score, grade, breakdown } = scoreLead(lead);
  lead.score = score;
  lead.grade = grade;
  lead.score_breakdown = JSON.stringify(breakdown);

  const result = insertLead.run(lead);
  const created = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);

  if (score >= HOT_LEAD_THRESHOLD) {
    notifyHotLead(created).catch((err) => console.error('[mailer] notify failed:', err.message));
  }

  res.status(201).json({ success: true, lead: created });
});

const SORT_COLUMNS = new Set(['created_at', 'score', 'company_name', 'monthly_bill_usd']);

app.get('/api/leads', requireAdmin, (req, res) => {
  const sort = SORT_COLUMNS.has(req.query.sort) ? req.query.sort : 'score';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const grade = ['hot', 'warm', 'cool'].includes(req.query.grade) ? req.query.grade : null;

  const rows = grade
    ? db.prepare(`SELECT * FROM leads WHERE grade = ? ORDER BY ${sort} ${dir}`).all(grade)
    : db.prepare(`SELECT * FROM leads ORDER BY ${sort} ${dir}`).all();

  res.json({ success: true, leads: rows });
});

app.get('/api/leads/export.csv', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM leads ORDER BY score DESC').all();
  const columns = rows.length
    ? Object.keys(rows[0]).filter((c) => c !== 'score_breakdown')
    : [];

  const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [columns.join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(','));
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="leads.csv"');
  res.send(lines.join('\n'));
});

app.patch('/api/leads/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ success: false, error: 'status required' });

  const result = db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ success: false, error: 'not found' });

  const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json({ success: true, lead: updated });
});

app.listen(PORT, () => {
  console.log(`Solar + battery leads engine running at http://localhost:${PORT}`);
  console.log(`Admin dashboard: http://localhost:${PORT}/admin.html`);
});
