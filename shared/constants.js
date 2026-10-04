// Single source of truth for persisted settings, their defaults, and shared enums.
// Imported by the worker, the popup and the tests — never hand-copy these lists.

export const FILTER_DEFAULTS = {
  jobTypes: [],              // [] = any; else subset of ['hourly', 'fixed']
  experience: [],            // [] = any; else subset of ['entry', 'intermediate', 'expert']
  minFixedBudget: 0,         // USD; 0 = off
  minHourlyMax: 0,           // the client's top hourly rate must reach this; 0 = off
  maxProposals: '',          // '' = off; else a PROPOSAL_BUCKETS key — jobs above it are flagged
  minClientSpent: 0,         // USD; 0 = off
  minHireRate: 0,            // percent; 0 = off
  requirePaymentVerified: false,
  requireHiredBefore: false,
  minClientRating: 0,        // 0–5; 0 = off
  maxConnects: 0,            // 0 = off
  maxAgeMin: 0,              // only jobs posted less than N minutes ago; 0 = off
  countriesExclude: [],      // exact ISO code or country name (never substring — see NOTES)
  keywordsExclude: [],       // whole-word, case-insensitive, title + description
};

export const SETTINGS_DEFAULTS = {
  aiProvider: 'gemini',
  geminiApiKey: '',
  geminiModel: 'gemini-2.5-flash',
  openrouterApiKey: '',
  openrouterModel: 'google/gemini-2.5-flash',
  profileSkills: '',         // comma-separated; the AI is given the first 12
  hourlyRate: 0,             // your profile rate (USD); 0 = use the client's range / leave the field alone
  hourlyStrategy: 'profile', // 'profile' | 'within_range' (clamp your rate into the client's posted range)
  fixedBidRatio: 1,          // fixed-price bid = budget × ratio (whole number)
  minFixedBid: 0,            // floor for fixed-price bids; 0 = off
  autoFill: true,            // when a draft is ready on a proposal page, fill it in (never submits)
  fillRate: true,            // also set the rate/bid field (first fill only when automatic)
  filters: FILTER_DEFAULTS,
};

export const SETTINGS_KEYS = Object.keys(SETTINGS_DEFAULTS);
export const SECRET_KEYS = ['geminiApiKey', 'openrouterApiKey'];
export const EXPORT_KEYS = SETTINGS_KEYS.filter(k => !SECRET_KEYS.includes(k));

// Upwork's "Proposals:" activity buckets as shown on the job page (verified on a public job
// page 2026-10-04: "Proposals:\n50+"). `mid` is a rough count for scoring.
export const PROPOSAL_BUCKETS = {
  'less than 5': { rank: 0, mid: 2 },
  '5 to 10': { rank: 1, mid: 7 },
  '10 to 15': { rank: 2, mid: 12 },
  '15 to 20': { rank: 3, mid: 17 },
  '20 to 50': { rank: 4, mid: 35 },
  '50+': { rank: 5, mid: 60 },
};

// Proposal lifecycle. Everything after 'submitted' is set by YOU in the Jobs tab — the
// extension never reads "My proposals" on its own (see NOTES: Upwork flags background reads).
export const STATUSES = ['read', 'drafted', 'filled', 'submitted', 'viewed', 'interview', 'offer', 'hired', 'declined', 'no_reply', 'skipped'];
export const OUTCOME_STATUSES = ['viewed', 'interview', 'offer', 'hired', 'declined', 'no_reply'];

// Upwork's project-duration options on the proposal form (unverified wording — the AI picks
// one; it is shown, never auto-selected, because the control is a custom dropdown).
export const DURATIONS = ['Less than 1 month', '1 to 3 months', '3 to 6 months', 'More than 6 months'];

export const JOBS_CAP = 500;
export const LOG_CAP = 500;
export const AI_TIMEOUT_MS = 45000;
export const MAX_COVER_CHARS = 5000;
