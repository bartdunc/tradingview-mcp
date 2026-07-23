# Solar + Battery Commercial Leads Engine

A self-contained lead capture and scoring tool for commercial solar + battery storage sales.

- **Public site** (`/`) — multi-step form for commercial prospects (company info, facility details, energy usage, project timeline).
- **Scoring engine** (`src/scoring.js`) — every submission is scored 0–100 across signals that matter for commercial solar/battery deals: monthly energy spend, roof/land area, property ownership, project timeline, solar vs. battery interest, backup-power urgency, decision-maker role, and stated budget. Leads are graded `hot` (≥75), `warm` (50–74), or `cool` (<50).
- **Admin dashboard** (`/admin.html`) — sortable/filterable lead list, status tracking (new → contacted → qualified → proposal-sent → closed), and CSV export.
- **Hot lead alerts** — optional email notification (via SMTP) fires automatically whenever a submission scores at or above the hot-lead threshold.

## Setup

```bash
cd solar-battery-leads
npm install
cp .env.example .env
# edit .env: set ADMIN_TOKEN at minimum; SMTP_* only if you want email alerts
npm start
```

Then open:
- `http://localhost:3300` — the lead capture form
- `http://localhost:3300/admin.html` — the admin dashboard (paste your `ADMIN_TOKEN` to load leads)

Leads are stored in a local SQLite file at `data/leads.db` (auto-created on first run, gitignored).

## API

| Method | Path                    | Auth  | Description                          |
|--------|-------------------------|-------|---------------------------------------|
| POST   | `/api/leads`            | none  | Submit a new lead (public form)       |
| GET    | `/api/leads`            | admin | List leads (`?sort=`, `?dir=`, `?grade=`) |
| PATCH  | `/api/leads/:id`        | admin | Update a lead's status                |
| GET    | `/api/leads/export.csv` | admin | Export all leads as CSV               |

Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`.

## Scoring rubric

| Signal                     | Max points |
|----------------------------|-----------|
| Monthly energy spend       | 30        |
| Project timeline           | 20        |
| Property ownership         | 10        |
| Interest (solar vs battery)| 10        |
| Backup power priority      | 10        |
| Roof / land area           | 10        |
| Decision-maker role         | 5         |
| Budget specified           | 5         |

Tune thresholds and weights in `src/scoring.js`.
