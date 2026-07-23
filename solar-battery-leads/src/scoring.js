// Commercial solar + battery storage lead scoring.
// Weighted 0-100 across signals that correlate with project size, urgency, and closability.

function scoreTier(value, tiers) {
  for (const [min, points] of tiers) {
    if (value >= min) return points;
  }
  return 0;
}

function scoreMonthlyBill(monthlyBillUsd) {
  const v = Number(monthlyBillUsd) || 0;
  return scoreTier(v, [
    [15000, 30],
    [8000, 24],
    [4000, 18],
    [2000, 12],
    [500, 6],
    [0, 2],
  ]);
}

function scoreFacilitySize(roofLandSqft) {
  const v = Number(roofLandSqft) || 0;
  return scoreTier(v, [
    [100000, 10],
    [50000, 8],
    [20000, 6],
    [5000, 3],
    [0, 1],
  ]);
}

const OWNERSHIP_POINTS = {
  own: 10,
  'lease-long-term': 6,
  lease: 3,
  unsure: 0,
};

const TIMELINE_POINTS = {
  immediate: 20, // < 3 months
  '3-6mo': 15,
  '6-12mo': 8,
  '12mo-plus': 3,
  researching: 0,
};

const INTEREST_POINTS = {
  'solar-battery': 10,
  battery: 8,
  solar: 6,
  unsure: 2,
};

const BACKUP_PRIORITY_POINTS = {
  critical: 10,
  moderate: 5,
  low: 0,
};

const ROLE_POINTS = {
  owner: 5,
  executive: 5,
  facilities: 4,
  sustainability: 3,
  other: 1,
};

function lookup(map, key, fallback = 0) {
  if (!key) return fallback;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function scoreLead(lead) {
  const breakdown = [
    { label: 'Monthly energy spend', points: scoreMonthlyBill(lead.monthly_bill_usd), max: 30 },
    { label: 'Roof / land area', points: scoreFacilitySize(lead.roof_land_sqft), max: 10 },
    { label: 'Property ownership', points: lookup(OWNERSHIP_POINTS, lead.property_ownership), max: 10 },
    { label: 'Project timeline', points: lookup(TIMELINE_POINTS, lead.timeline), max: 20 },
    { label: 'Interest (solar/battery)', points: lookup(INTEREST_POINTS, lead.interest), max: 10 },
    { label: 'Backup power priority', points: lookup(BACKUP_PRIORITY_POINTS, lead.backup_power_priority), max: 10 },
    { label: 'Decision-maker role', points: lookup(ROLE_POINTS, lead.role), max: 5 },
    { label: 'Budget specified', points: lead.budget_range ? 5 : 0, max: 5 },
  ];

  const score = breakdown.reduce((sum, item) => sum + item.points, 0);
  const grade = score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cool';

  return { score, grade, breakdown };
}

module.exports = {
  scoreLead,
  OWNERSHIP_POINTS,
  TIMELINE_POINTS,
  INTEREST_POINTS,
  BACKUP_PRIORITY_POINTS,
  ROLE_POINTS,
};
