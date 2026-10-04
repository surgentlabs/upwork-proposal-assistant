// Turns what pageAgent('read') saw into a structured job record. Pure — no chrome, no DOM.
//
// Upwork's markup uses hashed class names that change often, so parsing keys off the VISIBLE
// LABELS instead ("Proposals:", "Interviewing:", "Member since …", "$… total spent").
// Verification status of every pattern is tracked in NOTES.md (v0.1.0 — "Page reading").
import { COUNTRIES } from './countries.js';
import { PROPOSAL_BUCKETS } from './constants.js';

// Sections after these headings belong to OTHER jobs or marketing copy (e.g. "Explore similar
// jobs" lists more "Fixed-price" lines, and the footer has "Rating is 4.9 out of 5").
const CUT_MARKERS = [/\n\s*Explore similar jobs/i, /\n\s*Similar jobs on Upwork/i, /\n\s*Other open jobs by this client/i,
  /\n\s*Client's recent history/i, /\n\s*How it works\s*\n/i, /\n\s*About Upwork\s*\n/i];

export function jobIdFromUrl(url) {
  const m = String(url || '').match(/~(0[0-9a-z]{9,})/i);
  return m ? `~${m[1].toLowerCase()}` : null;
}

export function pageKind(url, fields = []) {
  const u = String(url || '');
  if (/\/proposals\/job\/[^/]*~?[^/]*\/apply/i.test(u) || /\/apply\/?(\?|$)/i.test(u) && /\/proposals\//i.test(u)) return 'apply';
  if (fields.some(f => /cover letter/i.test(f.label || ''))) return 'apply';
  if (jobIdFromUrl(u)) return 'job';
  return 'other';
}

export function cutText(text) {
  let t = String(text || '').replace(/\r\n?/g, '\n');
  for (const re of CUT_MARKERS) { const m = t.search(re); if (m > 200) t = t.slice(0, m); }
  return t;
}

const n = s => { const v = parseFloat(String(s).replace(/,/g, '')); return isFinite(v) ? v : null; };
const money = (amount, suffix) => { const v = n(amount); if (v == null) return null; const s = String(suffix || '').toLowerCase(); return Math.round(v * (s === 'k' ? 1e3 : s === 'm' ? 1e6 : 1)); };
const lines = t => t.split('\n').map(s => s.trim()).filter(Boolean);
const first = (t, ...res) => { for (const re of res) { const m = t.match(re); if (m) return m; } return null; };

export function parsePostedMinutes(t) {
  if (/Posted\s+(just now|a moment ago|seconds? ago)/i.test(t)) return 0;
  if (/Posted\s+yesterday/i.test(t)) return 1440;
  const m = t.match(/Posted\s+(?:on\s+)?(\d+|an?|a few)\s+(second|minute|min|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const q = /^\d+$/.test(m[1]) ? Number(m[1]) : /few/i.test(m[1]) ? 3 : 1;
  const unit = m[2].toLowerCase();
  const per = { second: 1 / 60, minute: 1, min: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 }[unit];
  return Math.round(q * per);
}

export function countryFromLines(ls) {
  const byName = new Map();
  for (const [code, ...names] of COUNTRIES) for (const nm of names) byName.set(nm.toLowerCase(), { code, name: names[0] === nm ? nm : names[0] });
  for (const l of ls) {
    const hit = byName.get(l.toLowerCase());
    if (hit) return { code: hit.code, name: l };
  }
  return null;
}

// Lines following a heading, until a stop heading. Used for skills and screening questions.
function sectionLines(ls, startRe, stopRe, max = 25) {
  const i = ls.findIndex(l => startRe.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of ls.slice(i + 1)) {
    if (stopRe.test(l)) break;
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

const SECTION_STOP = /^(Activity on this job|About the client|Preferred qualifications|Proposals:|Explore |Client's recent history|Other open jobs|Attachments?|You will be asked|Mandatory skills|Nice-to-have skills|Skills and Expertise|Questions?$|Apply now|Submit a proposal|Save job|Flag as inappropriate|Send a proposal for)/i;

export function parseJobText(read) {
  const raw = cutText(read?.mainText || '');
  const ls = lines(raw);
  const job = { title: read?.title || '', url: read?.url || '', id: jobIdFromUrl(read?.url) };

  // ── Job ──
  job.postedMinutesAgo = parsePostedMinutes(raw);
  const fixedM = first(raw, /\$([\d,]+(?:\.\d+)?)\s*\n\s*Fixed[- ]price/i, /Fixed[- ]price[^\n$]{0,30}\$([\d,]+(?:\.\d+)?)/i, /Est\. budget:?\s*\$([\d,]+(?:\.\d+)?)/i);
  const hourlyM = first(raw, /\$([\d,]+(?:\.\d+)?)\s*[-–]\s*\$([\d,]+(?:\.\d+)?)\s*(?:\/\s*hr)?\s*\n?\s*Hourly/i, /\$([\d,]+(?:\.\d+)?)\s*[-–]\s*\$([\d,]+(?:\.\d+)?)\s*\/\s*hr/i, /Hourly:\s*\$([\d,]+(?:\.\d+)?)\s*[-–]\s*\$([\d,]+(?:\.\d+)?)/i);
  const hasFixed = fixedM || ls.some(l => /^fixed[- ]price$/i.test(l));
  const hasHourly = hourlyM || ls.some(l => /^hourly$/i.test(l) || /^hourly\s*[:‐-]/i.test(l));
  job.jobType = hasHourly && !hasFixed ? 'hourly' : hasFixed && !hasHourly ? 'fixed' : hasHourly ? 'hourly' : null;
  job.budget = job.jobType === 'fixed' && fixedM ? n(fixedM[1]) : null;
  job.hourlyMin = hourlyM ? n(hourlyM[1]) : null;
  job.hourlyMax = hourlyM ? n(hourlyM[2]) : null;
  const exp = first(raw, /(Entry level|Intermediate|Expert)\s*\n\s*Experience level/i, /Experience level:?\s*\n?\s*(Entry level|Intermediate|Expert)/i);
  job.experience = exp ? exp[1].toLowerCase().replace(' level', '') : null;
  const dur = first(raw, /(Less than 1 month|1 to 3 months|1-3 months|3 to 6 months|3-6 months|More than 6 months)/i);
  job.projectLength = dur ? dur[1].replace('-', ' to ') : null;
  const hrs = first(raw, /(Less than 30 hrs\/week|More than 30 hrs\/week|30\+ hrs\/week|Hours to be determined)/i);
  job.hoursPerWeek = hrs ? hrs[1] : null;

  // ── Activity on this job ── (verified labels on a public job page, 2026-10-04)
  const prop = raw.match(/Proposals:?\s*\n?\s*(Less than 5|5 to 10|10 to 15|15 to 20|20 to 50|50\+)/i);
  job.proposals = prop ? prop[1].toLowerCase() : null;
  job.proposalsMid = job.proposals ? PROPOSAL_BUCKETS[job.proposals]?.mid ?? null : null;
  const lv = raw.match(/Last viewed by client:?\s*\n?\s*([^\n]+)/i);
  job.lastViewed = lv ? lv[1].trim() : null;
  const intv = raw.match(/Interviewing:?\s*\n?\s*(\d+)/i);
  job.interviewing = intv ? Number(intv[1]) : null;
  const inv = raw.match(/Invites sent:?\s*\n?\s*(\d+)/i);
  job.invitesSent = inv ? Number(inv[1]) : null;
  const una = raw.match(/Unanswered invites:?\s*\n?\s*(\d+)/i);
  job.unansweredInvites = una ? Number(una[1]) : null;

  // ── Connects ── (unverified wording; logged-in pages only)
  const cr = first(raw, /Send a proposal for:?\s*(\d+)\s*Connects?/i, /requires?\s*:?\s*(\d+)\s*Connects?/i, /(\d+)\s*Connects?\s*(?:required|to apply|to submit)/i);
  job.connects = cr ? Number(cr[1]) : null;
  const ca = first(raw, /Available Connects:?\s*(\d+)/i, /You have\s*(\d+)\s*Connects?/i, /(\d+)\s*Connects?\s*(?:available|remaining|left)/i);
  job.connectsBalance = ca ? Number(ca[1]) : null;

  // ── Client ── (only "Member since" and the country are visible logged-out — verified; the
  // rest is the logged-in "About the client" card, unverified until a capture confirms it)
  const ci = ls.findIndex(l => /^About the client$/i.test(l));
  const clientLines = ci >= 0 ? ls.slice(ci + 1, ci + 40) : ls;
  const clientText = clientLines.join('\n');
  const client = {};
  client.paymentVerified = /Payment method not verified|Payment (method )?unverified/i.test(clientText) ? false
    : /Payment method verified|Payment verified/i.test(clientText) ? true : null;
  const rate = first(clientText, /Rating is ([\d.]+) out of 5/i, /^([0-5](?:\.\d+)?)\s*(?:of|\()\s*\d+\s*reviews?/im);
  client.rating = rate ? n(rate[1]) : null;
  const rev = clientText.match(/(?:of\s+|\()?(\d+)\s+reviews?/i);
  client.reviews = rev ? Number(rev[1]) : null;
  const sp = clientText.match(/\$([\d,.]+)\s*([KkMm])?\+?\s*total spent/i);
  client.totalSpent = sp ? money(sp[1], sp[2]) : null;
  const hires = clientText.match(/(\d+)\s+hires?\b/i);
  client.hires = hires ? Number(hires[1]) : null;
  const hr = clientText.match(/(\d+)%\s*hire rate/i);
  client.hireRate = hr ? Number(hr[1]) : null;
  const oj = clientText.match(/(\d+)\s+open jobs?/i);
  client.openJobs = oj ? Number(oj[1]) : null;
  const jp = clientText.match(/(\d+)\s+jobs?\s+posted/i);
  client.jobsPosted = jp ? Number(jp[1]) : null;
  const ah = clientText.match(/\$([\d,.]+)\s*\/\s*hr\s*avg hourly rate paid/i);
  client.avgHourlyPaid = ah ? n(ah[1]) : null;
  const ms = raw.match(/Member since\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})/i);
  client.memberSince = ms ? ms[1] : null;
  const c = countryFromLines(clientLines);
  client.country = c ? c.name : null;
  client.countryCode = c ? c.code : null;
  job.client = client;

  // ── Skills, screening questions, description ──
  job.skills = sectionLines(ls, /^Skills and Expertise$/i, SECTION_STOP)
    .filter(l => l.length <= 60 && !/^(Mandatory|Nice-to-have)/i.test(l) && !/^\+\d+$/.test(l));
  job.questions = sectionLines(ls, /You will be asked to answer the following questions/i, SECTION_STOP, 10)
    .map(l => l.replace(/^\d+[.)]\s*/, '').trim()).filter(l => l.length > 3);
  job.description = (read?.description || '').trim() || descriptionFallback(ls);
  return job;
}

function descriptionFallback(ls) {
  const i = ls.findIndex(l => /^Summary$/i.test(l));
  if (i < 0) return '';
  const stop = /^(Less than 30 hrs\/week|More than 30 hrs\/week|Hours to be determined|Hourly|Fixed[- ]price|\$[\d,.]+|Skills and Expertise|Activity on this job)$/i;
  const out = [];
  for (const l of ls.slice(i + 1)) { if (stop.test(l)) break; out.push(l); }
  return out.join('\n');
}

// Merge a fresh parse into a stored record: fresh non-null values win; arrays only when non-empty.
export function mergeJob(old = {}, fresh = {}) {
  const out = { ...old };
  for (const [k, v] of Object.entries(fresh)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) { if (v.length) out[k] = v; continue; }
    if (typeof v === 'object') { out[k] = mergeJob(old[k] || {}, v); continue; }
    out[k] = v;
  }
  return out;
}
