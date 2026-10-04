// Proposal drafting: rate decision, the AI prompt, tolerant parsing of the reply, the layout
// safety net and the template fallback. Pure apart from the injected `log`.
// The writing rules are carried over from Freelancer AutoBidder v2.25–v2.26.1 (real user
// feedback) and adapted for Upwork: screening questions are answered separately, each in its
// own field, and Upwork shows your name beside the proposal, so there is no sign-off.
import { DURATIONS, MAX_COVER_CHARS } from '../shared/constants.js';
import { clamp } from './util.js';

export const BANNED = ['I am excited', 'I would love to', 'I hope this finds you well', 'I am writing to', 'Dear client', 'Dear sir', 'Dear Hiring Manager', 'Greetings',
  'As an expert', 'As a seasoned', 'As a highly skilled', 'I have gone through your requirements', 'I can assure you', 'rest assured', 'leverage', 'seamless',
  'robust', 'cutting-edge', 'passionate', 'synergy', 'top-notch', '100% satisfaction', '24/7', 'unlimited revisions', 'kindly', 'utilize', 'delve'];

// Whole-number rate/bid. Hourly: your profile rate (optionally clamped into the client's
// posted range). Fixed: the client's budget × your ratio, with an optional floor.
export function decideRate(job, cfg) {
  if (job.jobType === 'fixed') {
    if (!(job.budget > 0)) return { rate: 0, unit: 'fixed' };
    let v = Math.round(job.budget * (cfg.fixedBidRatio || 1));
    if (cfg.minFixedBid > 0) v = Math.max(v, Math.round(cfg.minFixedBid));
    return { rate: Math.max(1, v), unit: 'fixed' };
  }
  if (job.jobType === 'hourly') {
    let r = cfg.hourlyRate || job.profileRate || 0;   // Settings rate, else your profile rate read off the proposal page
    if (r > 0 && cfg.hourlyStrategy === 'within_range' && job.hourlyMin > 0 && job.hourlyMax >= job.hourlyMin) r = clamp(r, job.hourlyMin, job.hourlyMax);
    return { rate: Math.round(r), unit: 'hourly' };
  }
  return { rate: 0, unit: null };
}

// Questions the client asks inside the brief itself (not Upwork screening questions) — the
// cover letter answers those up front. Carried over from AutoBidder.
export function extractBriefQuestions(description) {
  if (!description) return [];
  const trigger = /(when applying|please (provide|answer|include|share|confirm|tell|let me know)|in your (bid|proposal|application|response|cover letter)|address the following|answer (these|the following)|start your (proposal|cover letter) with)/i;
  const out = [];
  let capturing = false;
  for (const raw of description.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const isList = /^(\d+[.)]|[-*•])\s+/.test(line);
    const isQ = /\?\s*$/.test(line);
    if (trigger.test(line)) { capturing = true; if (!isList && !isQ) { out.push(line.slice(0, 220)); continue; } }
    if ((capturing && isList) || isQ) {
      const cleaned = line.replace(/^(\d+[.)]|[-*•])\s+/, '').trim();
      if (cleaned.length > 3 && cleaned.length < 220) out.push(cleaned);
    } else if (capturing && out.length && !isList) {
      capturing = false;
    }
    if (out.length >= 6) break;
  }
  return [...new Set(out)];
}

const ANGLES = [
  'Open with the one detail of this brief that most changes how the job should be done, and what you would do about it.',
  'Open by restating the client\'s goal in one plain sentence, in their own words, then the first thing you would check.',
  'Open with the concrete end result they will have in hand when you are done.',
  'Open with a specific, non-obvious risk or gotcha in this kind of work and how you avoid it.',
];

export function buildPrompt(job, cfg, { rate, unit }, questions, rnd = Math.random) {
  const skills = String(cfg.profileSkills || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12).join(', ');
  const briefQs = extractBriefQuestions(job.description);
  const angle = ANGLES[Math.floor(rnd() * ANGLES.length)];
  const budget = job.jobType === 'fixed' && job.budget ? `Fixed price, client budget $${job.budget}`
    : job.jobType === 'hourly' ? `Hourly${job.hourlyMin ? `, client range $${job.hourlyMin}–$${job.hourlyMax}/hr` : ''}${job.hoursPerWeek ? `, ${job.hoursPerWeek}` : ''}`
    : '(not stated)';
  const priceLine = rate > 0
    ? (unit === 'hourly' ? `Your rate: $${rate}/hr` : `Your bid: $${rate} fixed`)
    : 'No rate is set — do not state a number; say you will confirm the price once the scope is pinned down.';
  const brief = (job.description || job.fallbackText || '(not provided)').slice(0, 9000);

  return [
    'You are the freelancer applying to this Upwork job, writing in the first person. You have done exactly this kind of work many times; the client should feel that within two lines — without you ever saying so.',
    `Your skills (from your profile): ${skills || '(not listed)'}`,
    `The skills this job needs: ${(job.skills || []).join(', ') || '(not tagged)'}`,
    'Position yourself as a specialist in precisely what this job needs: use the vocabulary, tools and judgement calls a practitioner in that field would, and name the specific choices you would make for THIS job. Be confident and concrete, but do NOT invent verifiable facts — no made-up past clients, company names, portfolio links, certifications, years-of-experience figures or statistics.',
    `Job title: ${job.title || '(untitled)'}`,
    `Client's brief:\n${brief}`,
    `Budget: ${budget}`,
    job.projectLength ? `Expected length: ${job.projectLength}` : '',
    job.descriptionTruncated ? 'Note: the brief above is cut short (only its start was visible). Work with what is there; do not guess at the missing part.' : '',
    job.experience ? `Experience level wanted: ${job.experience}` : '',
    priceLine,
    briefQs.length ? `Inside the brief, the client asks applicants to:\n${briefQs.map((q, i) => `${i + 1}. ${q}`).join('\n')}\nHandle these in the cover letter first (one short line each), before the paragraphs.` : '',
    'COVER LETTER — layout is mandatory:',
    '- Line 1 is a one-word greeting on its own line: "Hi," (or the equivalent in the brief\'s language). Then a blank line.',
    '- Then three or four short paragraphs, each 1–3 sentences (never more than ~50 words), separated by a BLANK LINE — "\\n\\n" in the JSON string. Never one block of text.',
    `- Paragraph 1: ${angle.charAt(0).toLowerCase() + angle.slice(1)} Mirror at least two specific details from the brief, then one plain line on what you do. These first two lines are all the client sees in their proposal list, so make them about THIS job.`,
    '- Paragraph 2: a concrete 2–4 step plan with the specific tools or methods a practitioner would pick, and one thing you would make sure NOT to get wrong.',
    '- Paragraph 3: the price or rate and the timeline, mentioned once and tied to what is included.',
    '- Last paragraph: one clear, low-friction next step (a specific scoping question or a small first milestone). At most one question in the whole cover letter.',
    'Voice (cover letter and answers):',
    '- Sound like a real person who typed this in one sitting: contractions, plain words, varied sentence length. No headings, no bullet points, no emojis, no exclamation marks, no sign-off and no name — Upwork shows your name beside the proposal.',
    `- Never use: ${BANNED.map(b => `"${b}"`).join(', ')}.`,
    '- Write in the same language as the brief. Whole-number amounts only. Write durations correctly: "1 day", "3 days", "1 week".',
    '- Cover letter length: 110 to 190 words.',
    '- When something only the real freelancer can supply is needed (a link to past work, a specific past project, exact availability), write a short placeholder in square brackets, e.g. [link to a similar project]. Never invent it.',
    questions.length
      ? `SCREENING QUESTIONS — Upwork asks these in separate fields. Answer each one separately, directly and specifically to this job, in 1–4 sentences, in the same voice. No greeting, don't repeat the question, don't refer to the cover letter:\n${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
      : '',
    `DURATION — pick the one option that fits this scope: ${DURATIONS.map(d => `"${d}"`).join(', ')}.`,
    unit === 'fixed' ? 'MILESTONE — one short line (under 60 characters) naming what the client gets for the full amount, e.g. "Full 7-page site built, tested and launched".' : '',
    'ASSESSMENT — also rate the job honestly for the freelancer, 0 to 1: "fit" (how well it matches your skills), "clarity" (how clear the scope is), "risk" (scam / off-platform payment / free-work / ToS risk). "flags": short reasons for any risk, else [].',
    'Respond with ONLY a valid JSON object (no markdown, no backticks):',
    `{"cover_letter": "…", "answers": [${questions.map(() => '"…"').join(', ')}], "duration": "…",${unit === 'fixed' ? ' "milestone": "…",' : ''} "assessment": {"fit": 0.0, "clarity": 0.0, "risk": 0.0, "flags": []}}`,
  ].filter(Boolean).join('\n\n');
}

// Escape raw control characters inside JSON string literals (models often emit real newlines
// inside "cover_letter", which is invalid JSON and broke parsing in AutoBidder before v2.26.1).
export function repairJson(txt) {
  let out = '', inStr = false, esc = false;
  for (const ch of txt) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') inStr = true;
      out += ch;
    }
  }
  return out;
}

export function parseDraftJson(rawText) {
  const txt = String(rawText || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
  const tries = [txt];
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s >= 0 && e > s) tries.push(txt.slice(s, e + 1));
  for (const t of tries) {
    for (const cand of [t, repairJson(t)]) {
      try { const j = JSON.parse(cand); if (j && typeof j === 'object') return j; } catch (_) {}
    }
  }
  const m = txt.match(/"cover_letter"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"(?:answers|duration|assessment)"|}\s*$)/);
  if (m) return { cover_letter: m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') };
  if (!txt.startsWith('{') && !txt.includes('"cover_letter"') && txt.length > 80) return { cover_letter: txt };   // plain prose
  return null;
}

// Greeting line + blank-line-separated short paragraphs, even when the model ignored the layout.
export function ensureReadable(text, log = () => {}) {
  let t = String(text || '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) return t;
  const hasGreeting = /^(hi|hello|hey|good (morning|afternoon|evening)|dear|hola|bonjour|hallo|olá|ciao|salut)\b/i.test(t);
  if (!t.includes('\n')) {
    const sentences = t.match(/[^.!?]+[.!?]+(?=\s+[A-Z0-9"“(]|\s*$)|[^.!?]+$/g)?.map(x => x.trim()).filter(Boolean) || [t];
    if (sentences.length > 3) {
      const paras = [];
      let i = 0;
      if (hasGreeting && sentences[0].length < 30) { paras.push(sentences[0]); i = 1; }
      while (i < sentences.length) {
        const left = sentences.length - i;
        const take = left <= 3 ? left : (left === 4 ? 2 : 3);
        paras.push(sentences.slice(i, i + take).join(' ')); i += take;
      }
      t = paras.join('\n\n');
      log('AI cover letter came back as one block — split into paragraphs.');
    }
  }
  if (!hasGreeting) t = `Hi,\n\n${t}`;
  // "Hi, I read…" → greeting on its own line. Only the greeting (plus an optional name) moves —
  // AutoBidder's pattern took everything up to the first full stop.
  else if (!/^[^\n]{1,40}\n\n/.test(t)) t = t.replace(/^((?:hi|hello|hey|good (?:morning|afternoon|evening)|dear|hola|bonjour|hallo|olá|ciao|salut)\b[^\n.!?,]{0,25}[,!.]?)[ \t]*\n?[ \t]*/i, '$1\n\n');
  return t;
}

export function capText(text, max) {
  if (!text || text.length <= max) return text;
  const slice = text.slice(0, max);
  const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('.\n'), slice.lastIndexOf('? '));
  return (cut > max * 0.5 ? slice.slice(0, cut + 1) : slice).trim();
}

const clean01 = v => { let x = parseFloat(v); if (!isFinite(x)) return null; if (x > 1) x /= 100; return clamp(x, 0, 1); };

// Normalise a parsed AI reply into a draft. `questions` is the list we asked about.
export function finishDraft(parsed, questions, { rate, unit }, log = () => {}) {
  let cover = String(parsed?.cover_letter ?? parsed?.coverLetter ?? parsed?.proposal ?? '').replace(/\\n/g, '\n').trim();
  if (!cover) return null;
  cover = cover.replace(/!/g, '.');
  cover = capText(ensureReadable(cover, log), MAX_COVER_CHARS);
  const rawAnswers = Array.isArray(parsed.answers) ? parsed.answers : [];
  const answers = questions.map((_, i) => String(rawAnswers[i] ?? '').replace(/\\n/g, '\n').replace(/!/g, '.').trim());
  if (questions.length && answers.some(a => !a)) log(`AI left ${answers.filter(a => !a).length} screening question(s) unanswered — fill those yourself.`, 'warn');
  const duration = DURATIONS.find(d => d.toLowerCase() === String(parsed.duration || '').toLowerCase()) || null;
  const a = parsed.assessment || {};
  const assessment = { fit: clean01(a.fit), clarity: clean01(a.clarity), risk: clean01(a.risk), flags: Array.isArray(a.flags) ? a.flags.map(String).slice(0, 5) : [] };
  const milestone = unit === 'fixed' && parsed.milestone ? String(parsed.milestone).replace(/[\r\n]+/g, ' ').trim().slice(0, 100) : null;
  return { coverLetter: cover, answers, duration, rate, unit, milestone, assessment, source: 'ai', ...qualityNotes(cover, answers) };
}

// Things to look at before submitting: placeholders to fill, banned phrases, length.
export function qualityNotes(cover, answers = []) {
  const all = [cover, ...answers].join('\n');
  const placeholders = [...new Set(all.match(/\[[^\]\n]{2,60}\]/g) || [])];
  const banned = BANNED.filter(b => new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(all));
  const words = cover.split(/\s+/).filter(Boolean).length;
  return { placeholders, banned, words };
}

export function templateDraft(job, cfg, questions, { rate, unit }) {
  const skills = String(cfg.profileSkills || '').split(',').map(s => s.trim()).filter(Boolean);
  const match = skills.filter(s => (job.skills || []).some(t => t.toLowerCase() === s.toLowerCase())).slice(0, 3);
  const priceLine = rate > 0 ? (unit === 'hourly' ? `My rate for this is $${rate}/hr` : `I can do this for $${rate}`) + ', and [timeline — what\'s included].' : '[Price and timeline, tied to what\'s included.]';
  const cover = [
    'Hi,',
    `I read your post about ${job.title ? `"${job.title}"` : 'this job'} and it's the kind of work I do${match.length ? ` day to day with ${match.join(', ')}` : ''}. [One specific detail from the brief and what you'd do about it.]`,
    '[Your 2–3 step plan, with the tools you\'d use and the one thing you\'d make sure not to get wrong.]',
    priceLine,
    '[One low-friction next step, e.g. a scoping question.]',
  ].join('\n\n');
  return { coverLetter: cover, answers: questions.map(() => ''), duration: null, rate, unit, assessment: null, source: 'template', ...qualityNotes(cover) };
}
