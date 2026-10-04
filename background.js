// Upwork Proposal Assistant — service worker (MV3 module).
//
// Assisted, never autonomous. Nothing here runs on a timer and the extension has no host
// permission for Upwork: it can only see a tab after you click the toolbar icon on it
// (activeTab), and it only reads that page and fills its fields. It never clicks, submits,
// navigates, or sends a request to Upwork. The only network calls are to your AI provider.
import { pageAgent } from './page/agent.js';
import { jobIdFromUrl, pageKind, parseJobText, mergeJob, cutText, isFeedUrl, parseFeedTile, splitFeedText } from './shared/parse.js';
import { classifyFields, buildFillItems, questionText } from './shared/form.js';
import { scoreJob, fmtAge, currentAge } from './shared/score.js';
import { STATUSES } from './shared/constants.js';
import { getConfig } from './bg/config.js';
import { log, clearLog } from './bg/log.js';
import { getJob, updateJob } from './bg/store.js';
import { callAI, testProvider } from './bg/ai.js';
import { decideRate, buildPrompt, parseDraftJson, finishDraft, templateDraft } from './bg/proposal.js';

const drafting = new Map();   // jobId → in-flight draft promise (re-entrancy guard)

// ─────────────────────────────────────────────────────────────
// Page access (activeTab only)
// ─────────────────────────────────────────────────────────────
export async function runAgent(tabId, action, payload = null) {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: pageAgent, args: [action, payload] });
    return res?.result ?? null;
  } catch (e) {
    const err = new Error(/cannot access|permission|host/i.test(e.message || '')
      ? 'Chrome only lets the extension see a page right after you click its icon on that page. Click the icon again on this tab.'
      : `Couldn't read the page: ${e.message}`);
    err.reason = 'no_access';
    throw err;
  }
}

function isUpwork(url) {
  try { return /(^|\.)upwork\.com$/i.test(new URL(url).hostname); } catch (_) { return false; }
}

function blockedResult(read) {
  const what = read.blocked === 'login' ? 'a login page' : 'a verification / challenge page';
  log(`Stopped: Upwork is showing ${what}. Nothing was read or filled — deal with it in the tab, then try again.`, 'warn');
  return { blocked: read.blocked };
}

// Read the open tab, parse it, merge into the stored job, score it.
export async function readTab(tabId) {
  const read = await runAgent(tabId, 'read');
  if (!read) throw new Error('The page returned nothing.');
  if (!isUpwork(read.url)) return { kind: 'other', url: read.url, reason: 'not_upwork' };
  if (read.blocked) return blockedResult(read);
  if (isFeedUrl(read.url)) return scoreFeed(tabId, read);
  const id = jobIdFromUrl(read.url);
  const kind = pageKind(read.url, read.fields);
  if (!id) return { kind: 'other', url: read.url, reason: 'no_job' };

  const cfg = await getConfig();
  const now = Date.now();
  const parsed = parseJobText(read);
  const form = kind === 'apply' ? classifyFields(read.fields) : null;
  const job = await updateJob(id, old => {
    const fresh = { ...parsed };
    if (fresh.postedMinutesAgo != null) fresh.postedAt = now - fresh.postedMinutesAgo * 60000;
    if (kind === 'apply' && old?.title) delete fresh.title;   // the proposal page's heading isn't the job title
    if (kind === 'apply') { delete fresh.url; fresh.applyUrl = read.url; }
    if (!old?.url && !fresh.url) fresh.url = `https://www.upwork.com/jobs/${id}`;
    // The proposal page shows only the start of the brief ("… more"); never let it replace the
    // full brief read earlier from the job page.
    if (old?.description && fresh.description && (fresh.descriptionTruncated || fresh.description.length < old.description.length)) {
      delete fresh.description; delete fresh.descriptionTruncated;
    }
    const rec = mergeJob(old || { id, status: 'read', firstReadAt: now }, fresh);
    if (!rec.description) rec.fallbackText = cutText(read.mainText).slice(0, 6000);
    if (form) rec.formQuestions = form.questions.map(q => q.text);
    // Came straight to the proposal page: the rate field's label tells hourly from fixed.
    if (form?.rate && !rec.jobType) rec.jobType = /hourly|\/\s*hr/i.test(form.rate.label) ? 'hourly' : 'fixed';
    rec.readAt = now;
    rec.score = scoreJob(rec, cfg, now);
    return rec;
  });
  if (!job.description && !job.fallbackText) log(`Read "${job.title}" but found no description — the AI will have little to go on.`, 'warn');
  log(`Read ${kind === 'apply' ? 'proposal page' : 'job'}: "${job.title}" — score ${job.score.score}${job.score.scams.length ? ` · ⚠ ${job.score.scams.join('; ')}` : ''}${job.score.misses.length ? ` · outside your filters: ${job.score.misses.join(', ')}` : ''}`,
    job.score.scams.length ? 'warn' : 'info');
  return { kind, job, form };
}

// ─────────────────────────────────────────────────────────────
// Drafting
// ─────────────────────────────────────────────────────────────
export function draftJob(id) {
  if (drafting.has(id)) return drafting.get(id);
  const p = (async () => {
    const job = await getJob(id);
    if (!job) throw new Error('Read the job first.');
    const cfg = await getConfig();
    const questions = (job.formQuestions?.length ? job.formQuestions : job.questions || []).map(questionText);
    const rd = decideRate(job, cfg);
    let draft;
    if (!cfg.geminiApiKey && !cfg.openrouterApiKey) {
      log('No AI key set — drafted from the template. Add a key under Settings for a written proposal.', 'warn');
      draft = { ...templateDraft(job, cfg, questions, rd), fell: 'no_key' };
    } else {
      try {
        const { text, provider } = await callAI(cfg, buildPrompt(job, cfg, rd, questions));
        const parsed = parseDraftJson(text);
        draft = parsed && finishDraft(parsed, questions, rd, log);
        if (!draft) throw Object.assign(new Error('the AI reply was not usable'), { reason: 'bad_reply' });
        draft.provider = provider;
      } catch (e) {
        log(`AI draft failed (${e.message}) — using the template instead.`, 'error');
        draft = { ...templateDraft(job, cfg, questions, rd), fell: e.reason || 'error' };
      }
    }
    draft.questions = questions;
    draft.createdAt = Date.now();
    const saved = await updateJob(id, rec => {
      if (!rec) return null;
      rec.draft = draft;
      if (STATUSES.indexOf(rec.status) < STATUSES.indexOf('drafted')) rec.status = 'drafted';
      return rec;
    });
    const a = draft.assessment;
    log(`Drafted ${draft.source === 'ai' ? `with ${draft.provider}` : 'from template'}: "${job.title}" — ${draft.words} words${questions.length ? `, ${draft.answers.filter(Boolean).length}/${questions.length} answers` : ''}${draft.rate ? `, ${draft.unit === 'hourly' ? `$${draft.rate}/hr` : `$${draft.rate}`}` : ''}${a?.risk >= 0.6 ? ` · AI risk ${Math.round(a.risk * 100)}%: ${a.flags.join('; ')}` : ''}${draft.placeholders.length ? ` · fill in ${draft.placeholders.length} placeholder(s)` : ''}`,
      a?.risk >= 0.6 ? 'warn' : 'info');
    return saved;
  })();
  drafting.set(id, p);
  p.finally(() => drafting.delete(id)).catch(() => {});
  return p;
}

// Match each form question to an answer: by question text first, then by position when the
// draft was made for the same number of questions.
export function answersForForm(form, draft) {
  const norm = s => questionText(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const dq = (draft.questions || []).map(norm);
  return form.questions.map((q, i) => {
    const j = dq.indexOf(norm(q.text));
    if (j >= 0) return draft.answers[j] || '';
    return dq.length === form.questions.length ? draft.answers[i] || '' : '';
  });
}

function draftCoversForm(form, draft) {
  if (!draft) return false;
  if (!form.questions.length) return true;
  return answersForForm(form, draft).every(Boolean);
}

// ─────────────────────────────────────────────────────────────
// Filling (never submits)
// ─────────────────────────────────────────────────────────────
export async function fillJob(id, tabId, { auto = false, overwrite = false } = {}) {
  const read = await runAgent(tabId, 'read');
  if (read?.blocked) return blockedResult(read);
  if (!read || jobIdFromUrl(read.url) !== id) return { ok: false, error: 'This tab is no longer on that job.' };
  if (pageKind(read.url, read.fields) !== 'apply') return { ok: false, error: 'Open the proposal page (Apply now) first, then click the icon again.' };
  const form = classifyFields(read.fields);
  const job = await getJob(id);
  if (!job?.draft) return { ok: false, error: 'No draft yet.' };
  const cfg = await getConfig();
  const draft = { ...job.draft, answers: answersForForm(form, job.draft) };
  const items = buildFillItems(form, draft, { fillRate: cfg.fillRate, overwrite, auto, rateAlreadyAutoFilled: !!job.rateAutoFilled });
  if (!items.length) return { ok: false, error: form.cover ? 'Nothing to fill.' : "Couldn't find the cover letter box on this page. Use Copy instead, and send me a page snapshot (Settings → Diagnostics)." };
  const res = await runAgent(tabId, 'fill', { items });
  const results = res?.results || [];
  const done = results.filter(r => r.ok).map(r => r.role);
  const skipped = results.filter(r => !r.ok);
  await updateJob(id, rec => {
    if (!rec) return null;
    rec.lastFill = { at: Date.now(), auto, results };
    if (done.length && STATUSES.indexOf(rec.status) < STATUSES.indexOf('filled')) rec.status = 'filled';
    if (auto && done.includes('rate')) rec.rateAutoFilled = true;
    return rec;
  });
  const qDone = done.filter(r => /^q\d+$/.test(r)).length;
  const viaMilestone = !form.rate && !!form.milestone;
  const parts = [done.includes('cover') && 'cover letter', form.questions.length && `${qDone}/${form.questions.length} answers`,
    done.includes('rate') && (viaMilestone ? `milestone 1 $${draft.rate}` : `rate $${draft.rate}`), done.includes('milestone') && 'milestone description'].filter(Boolean);
  log(`${auto ? 'Auto-filled' : 'Filled'} "${job.title}": ${parts.join(', ') || 'nothing'}${skipped.length ? ` (left alone: ${skipped.map(s => `${s.role} — ${s.reason}`).join('; ')})` : ''}. Review, set the duration${viaMilestone ? ' and the milestone due date' : ''}, and click Submit yourself.`);
  return { ok: true, results, done, skipped, unanswered: form.questions.length - qDone, duration: job.draft.duration, viaMilestone };
}

// What happens when you open the popup on a tab: read it; on a proposal page with auto-fill
// on, draft (if needed) and fill. On a job page it only reads and scores — drafting costs an
// AI call, so that waits for your click.
export async function assist(tabId) {
  const r = await readTab(tabId);
  if (r.blocked || r.kind !== 'apply') return r;
  const cfg = await getConfig();
  if (!cfg.autoFill) return r;
  let job = r.job;
  if (!draftCoversForm(r.form, job.draft)) job = await draftJob(job.id);
  const fill = await fillJob(job.id, tabId, { auto: true });
  return { ...r, job: await getJob(job.id), fill };
}

// ─────────────────────────────────────────────────────────────
// Feed scoring: you clicked the icon on the job feed. One read of the tiles already on the page
// — no extra requests, no "Load more", nothing stored except a log line.
// ─────────────────────────────────────────────────────────────
export async function scoreFeed(tabId, read) {
  const res = await runAgent(tabId, 'feed');
  let tiles = res?.tiles || [];
  if (!tiles.length) tiles = splitFeedText(read.mainText);   // no job links found → split the visible text
  const cfg = await getConfig();
  const { jobs = {} } = await chrome.storage.local.get('jobs');
  const now = Date.now();
  const items = tiles.map(t => {
    const job = parseFeedTile(t);
    if (job.postedMinutesAgo != null) job.postedAt = now - job.postedMinutesAgo * 60000;
    const id = t.id || jobIdFromUrl(t.href);
    const c = job.client || {};
    return {
      id, url: t.href || (id ? `https://www.upwork.com/jobs/${id}` : null), title: job.title || '(untitled)',
      jobType: job.jobType, budget: job.budget, hourlyMin: job.hourlyMin, hourlyMax: job.hourlyMax, experience: job.experience,
      projectLength: job.projectLength, proposals: job.proposals, postedAt: job.postedAt ?? null, postedMinutesAgo: job.postedMinutesAgo,
      client: { paymentVerified: c.paymentVerified, totalSpent: c.totalSpent, rating: c.rating, country: c.country },
      score: scoreJob(job, cfg, now), status: id ? jobs[id]?.status || null : null,
    };
  }).sort((a, b) => b.score.score - a.score.score);
  if (items.length) log(`Scored ${items.length} job${items.length === 1 ? '' : 's'} on the feed — best ${items[0].score.score}: "${items[0].title}"${items.filter(i => i.score.scams.length).length ? ` · ${items.filter(i => i.score.scams.length).length} with scam signals` : ''}`);
  else log("Found no job tiles on this page. Send a page snapshot (Settings → Diagnostics) so the feed reader can be fixed.", 'warn');
  return { kind: 'feed', url: read.url, items };
}

// A page capture for diagnosing selectors: visible text + the form's field labels. Field
// values are never included.
export async function snapshot(tabId) {
  const read = await runAgent(tabId, 'read');
  if (!read) throw new Error('The page returned nothing.');
  const manifest = chrome.runtime.getManifest?.() || {};
  return {
    capturedAt: new Date().toISOString(), version: manifest.version, url: read.url, kind: pageKind(read.url, read.fields), blocked: read.blocked,
    title: read.title, hasDescriptionHook: !!read.description,
    fields: read.fields.map(({ value, ...f }) => f),
    classified: classifyFields(read.fields),
    parsed: isUpwork(read.url) && !isFeedUrl(read.url) ? parseJobText(read) : null,
    feed: isFeedUrl(read.url) ? (await runAgent(tabId, 'feed'))?.tiles?.slice(0, 5).map(t => ({ ...t, parsed: parseFeedTile(t) })) : undefined,
    mainText: read.mainText,
  };
}

// ─────────────────────────────────────────────────────────────
// Messages from the popup
// ─────────────────────────────────────────────────────────────
const handlers = {
  ASSIST: m => assist(m.tabId),
  READ: m => readTab(m.tabId),
  DRAFT: m => draftJob(m.jobId),
  FILL: m => fillJob(m.jobId, m.tabId, { overwrite: !!m.overwrite }),
  SNAPSHOT: m => snapshot(m.tabId),
  TEST_AI: m => testProvider(m.provider, m.key, m.model),
  CLEAR_LOG: () => clearLog().then(() => log('Activity log cleared.')),
  SET_STATUS: async m => {
    if (!STATUSES.includes(m.status)) throw new Error('bad status');
    const rec = await updateJob(m.jobId, r => (r ? { ...r, status: m.status, statusAt: Date.now() } : null));
    if (rec) log(`Marked "${rec.title}" as ${m.status.replace('_', ' ')}.`);
    return rec;
  },
  SAVE_DRAFT: m => updateJob(m.jobId, r => {
    if (!r?.draft) return r;
    if (typeof m.coverLetter === 'string') r.draft.coverLetter = m.coverLetter;
    if (Array.isArray(m.answers)) r.draft.answers = m.answers.map(String);
    if (m.rate != null && isFinite(m.rate)) r.draft.rate = Math.round(Number(m.rate));
    r.draft.edited = true;
    return r;
  }),
  DELETE_JOB: m => updateJob(m.jobId, () => null).then(() => ({ ok: true })),
  RESCORE_ALL: async () => {
    const cfg = await getConfig();
    const { jobs = {} } = await chrome.storage.local.get('jobs');
    for (const id of Object.keys(jobs)) await updateJob(id, r => (r ? { ...r, score: scoreJob(r, cfg) } : null));
    return { ok: true, n: Object.keys(jobs).length };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve().then(() => h(msg))
    .then(result => sendResponse({ ok: true, result }))
    .catch(e => { log(e.message, 'error'); sendResponse({ ok: false, error: e.message }); });
  return true;   // async response
});

chrome.runtime.onInstalled?.addListener(d => {
  if (d?.reason === 'install') log('Installed. Open an Upwork job and click the toolbar icon to start.');
  else if (d?.reason === 'update') log(`Updated to v${chrome.runtime.getManifest().version}.`);
});

export { fmtAge, currentAge, handlers };
