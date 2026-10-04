// Job scoring, filter checks and scam signals. Pure. The score is a transparent rule-based
// heuristic (0–100, with every point explained) until there are enough labelled outcomes to
// train the on-device model in v0.4.
import { PROPOSAL_BUCKETS } from './constants.js';
import { COUNTRIES } from './countries.js';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wholeWord = (needle, hay) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(needle.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u').test(hay.toLowerCase());

// Exact code-or-name match — never substring (AutoBidder v2.26.2: "in" ⊂ "united kingdom").
export function isCountryExcluded(client, excludes = []) {
  if (!client || (!client.country && !client.countryCode)) return false;
  const norm = s => String(s || '').trim().toLowerCase();
  const names = new Set([norm(client.country), norm(client.countryCode)]);
  const row = COUNTRIES.find(r => r[0] === client.countryCode);
  if (row) row.forEach(x => names.add(norm(x)));
  names.delete('');
  return excludes.some(e => names.has(norm(e)));
}

// Signals that the post is a scam or a ToS problem. Each hit is a strong negative.
const SCAM_RULES = [
  [/\b(telegram|whats\s?app|wechat|signal app|viber)\b|\b(skype|discord) (me|id)\b|contact me (on|via|at) |off[- ]platform|outside (of )?upwork/i, 'asks to move the conversation off Upwork'],
  [/\bbank (details|account|info)|routing number|\bssn\b|social security|send (me )?(a copy of )?your (id|passport|driver'?s licen[cs]e)/i, 'asks for bank or ID details'],
  [/\bpay (a |the )?(fee|deposit)|pay (for|to buy) (the |your )?(training|equipment|software|materials|kit|license)|registration fee|purchase (the |your )?(own )?equipment|send (us |me )?(a )?cheque|deposit (a |the )?check/i, 'asks you to pay for something'],
  [/\bfree (test|sample|trial)( work| task)?\b|unpaid (test|trial|sample)|(test|trial) (task|work) (is )?unpaid|work for free/i, 'asks for free work'],
  [/\b(crypto(currency)? (payment|wallet)|usdt|pay (you )?in (btc|bitcoin|crypto))\b/i, 'wants to pay in crypto'],
  [/[\w.+-]+@[\w-]+\.(com|net|org|io|co)\b/i, 'includes an email address to contact'],
];

export function scamSignals(job) {
  const hay = `${job.title || ''}\n${job.description || ''}`;
  return SCAM_RULES.filter(([re]) => re.test(hay)).map(([, why]) => why);
}

// Which of YOUR filters this job falls outside. Filters never block anything — you opened the
// job yourself — they're shown as warnings so you don't spend Connects by accident.
export function filterMisses(job, f = {}) {
  const out = [];
  const c = job.client || {};
  if (f.jobTypes?.length && job.jobType && !f.jobTypes.includes(job.jobType)) out.push(`${job.jobType} job`);
  if (f.experience?.length && job.experience && !f.experience.includes(job.experience)) out.push(`${job.experience} level`);
  if (f.minFixedBudget > 0 && job.jobType === 'fixed' && job.budget != null && job.budget < f.minFixedBudget) out.push(`budget $${job.budget} < $${f.minFixedBudget}`);
  if (f.minHourlyMax > 0 && job.jobType === 'hourly' && job.hourlyMax != null && job.hourlyMax < f.minHourlyMax) out.push(`hourly up to $${job.hourlyMax} < $${f.minHourlyMax}`);
  if (f.maxProposals && job.proposals && PROPOSAL_BUCKETS[job.proposals] && PROPOSAL_BUCKETS[f.maxProposals] &&
      PROPOSAL_BUCKETS[job.proposals].rank > PROPOSAL_BUCKETS[f.maxProposals].rank) out.push(`${job.proposals} proposals`);
  if (f.minClientSpent > 0 && c.totalSpent != null && c.totalSpent < f.minClientSpent) out.push(`client spent $${c.totalSpent}`);
  if (f.minHireRate > 0 && c.hireRate != null && c.hireRate < f.minHireRate) out.push(`hire rate ${c.hireRate}%`);
  if (f.requirePaymentVerified && c.paymentVerified === false) out.push('payment not verified');
  if (f.requireHiredBefore && c.hires === 0) out.push('client has never hired');
  if (f.minClientRating > 0 && c.rating != null && c.rating < f.minClientRating) out.push(`client rating ${c.rating}`);
  if (f.maxConnects > 0 && job.connects != null && job.connects > f.maxConnects) out.push(`${job.connects} Connects`);
  const age = currentAge(job);
  if (f.maxAgeMin > 0 && age != null && age > f.maxAgeMin) out.push(`posted ${fmtAge(age)} ago`);
  if (isCountryExcluded(c, f.countriesExclude)) out.push(`client in ${c.country}`);
  const hay = `${job.title || ''}\n${job.description || ''}`;
  for (const k of f.keywordsExclude || []) if (k && wholeWord(k, hay)) out.push(`mentions "${k}"`);
  return out;
}

export function skillOverlap(job, profileSkills = []) {
  const mine = profileSkills.map(s => s.toLowerCase());
  const tagged = (job.skills || []).map(s => s.toLowerCase());
  const hay = `${job.title || ''}\n${job.description || ''}`;
  return profileSkills.filter((s, i) => tagged.includes(mine[i]) || wholeWord(s, hay));
}

export function fmtAge(min) {
  if (min == null) return '?';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

export function scoreJob(job, cfg = {}, now = Date.now()) {
  let s = 50;
  const reasons = [];
  const add = (pts, text) => { s += pts; reasons.push({ pts, text, tone: pts > 0 ? 'good' : pts < 0 ? 'bad' : 'neutral' }); };
  const c = job.client || {};

  if (c.paymentVerified === true) add(8, 'payment verified');
  else if (c.paymentVerified === false) add(-15, 'payment not verified');

  if (c.totalSpent != null) {
    if (c.totalSpent === 0) add(-8, 'client has spent $0');
    else if (c.totalSpent >= 100000) add(10, `client spent $${kfmt(c.totalSpent)}`);
    else if (c.totalSpent >= 10000) add(8, `client spent $${kfmt(c.totalSpent)}`);
    else if (c.totalSpent >= 1000) add(4, `client spent $${kfmt(c.totalSpent)}`);
  }
  if (c.hireRate != null) {
    if (c.hireRate >= 70) add(8, `${c.hireRate}% hire rate`);
    else if (c.hireRate >= 40) add(3, `${c.hireRate}% hire rate`);
    else add(-6, `${c.hireRate}% hire rate`);
  }
  if (c.hires === 0 && (c.jobsPosted || 0) > 1) add(-5, `never hired from ${c.jobsPosted} jobs`);
  if (c.rating != null && (c.reviews == null || c.reviews > 0)) {
    if (c.rating >= 4.7) add(5, `client rated ${c.rating}`);
    else if (c.rating < 4) add(-6, `client rated ${c.rating}`);
  }

  const bucket = job.proposals && PROPOSAL_BUCKETS[job.proposals];
  if (bucket) add([12, 8, 4, 0, -6, -12][bucket.rank], `${job.proposals} proposals`);
  if (job.interviewing != null) {
    if (job.interviewing >= 10) add(-10, `${job.interviewing} interviewing`);
    else if (job.interviewing >= 5) add(-6, `${job.interviewing} interviewing`);
    else if (job.interviewing === 0) add(3, 'nobody interviewing yet');
  }
  if (job.invitesSent >= 10) add(-3, `${job.invitesSent} invites sent`);

  const age = currentAge(job, now);
  if (age != null) {
    if (age < 60) add(8, `posted ${fmtAge(age)} ago`);
    else if (age < 240) add(4, `posted ${fmtAge(age)} ago`);
    else if (age > 4320) add(-10, `posted ${fmtAge(age)} ago`);
    else if (age > 1440) add(-6, `posted ${fmtAge(age)} ago`);
  }

  const mine = String(cfg.profileSkills || '').split(',').map(x => x.trim()).filter(Boolean);
  if (mine.length) {
    const hit = skillOverlap(job, mine);
    if (!hit.length) add(-15, 'none of your skills mentioned');
    else add(Math.min(12, hit.length * 4), `matches ${hit.slice(0, 4).join(', ')}`);
  }
  if (job.jobType === 'hourly' && cfg.hourlyRate > 0 && job.hourlyMax > 0 && cfg.hourlyRate > job.hourlyMax * 1.2) add(-6, `your rate is above their $${job.hourlyMax}/hr max`);
  if (job.connects > 16) add(-3, `${job.connects} Connects to apply`);

  const scams = scamSignals(job);
  for (const why of scams) add(-25, why);

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons, scams, misses: filterMisses(job, cfg.filters || {}) };
}

// Minutes since posting, now. postedAt is stamped when the page is read ("Posted 2 hours ago"
// → read time − 2 h), so a stored job keeps ageing correctly.
export function currentAge(job, now = Date.now()) {
  if (job.postedAt) return Math.max(0, Math.round((now - job.postedAt) / 60000));
  return job.postedMinutesAgo ?? null;
}

const kfmt = v => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}K` : String(v));
