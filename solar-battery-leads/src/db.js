const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'leads.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),

    company_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    role TEXT,

    facility_type TEXT,
    property_ownership TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    zip TEXT,

    roof_land_sqft INTEGER,
    monthly_bill_usd INTEGER,
    utility_provider TEXT,

    interest TEXT,
    backup_power_priority TEXT,
    timeline TEXT,
    budget_range TEXT,
    source TEXT,
    notes TEXT,

    score INTEGER NOT NULL,
    grade TEXT NOT NULL,
    score_breakdown TEXT,

    status TEXT NOT NULL DEFAULT 'new'
  )
`);

module.exports = db;
