// Popup (ES module). Talks to the worker by message; reads settings, jobs and the log from storage.
import { SETTINGS_DEFAULTS, SETTINGS_KEYS, SECRET_KEYS, EXPORT_KEYS, FILTER_DEFAULTS, STATUSES, OUTCOME_STATUSES } from './shared/constants.js';
import { fmtAge, currentAge } from './shared/score.js';
import { checkKey } from './shared/keys.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const local = keys => new Promise(r => chrome.storage.local.get(keys, r));
const STATUS_LABEL = { read: 'Read', drafted: 'Drafted', filled: 'Filled', submitted: 'Submitted', viewed: 'Viewed', interview: 'Interview', offer: 'Offer', hired: 'Hired', declined: 'Declined', no_reply: 'No reply', skipped: 'Skipped' };

let tabId = null;
let current = null;   // last ASSIST/READ result for this tab
let busy = false;

async function send(type, data = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...data });
  if (!res) throw new Error('No response from the extension.');
  if (!res.ok) throw new Error(res.error || 'Failed');
  return res.result;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) { const ta = Object.assign(document.createElement('textarea'), { value: text }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  toast('Copied');
}

// ── Tabs ──
function showTab(name) {
  document.querySelectorAll('nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('main > section').forEach(s => { s.hidden = s.id !== `tab-${name}`; });
  if (name === 'jobs') renderJobs();
  if (name === 'log') renderLog();
}
document.querySelectorAll('nav button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));

// ─────────────────────────────────────────────────────────────
// This job
// ─────────────────────────────────────────────────────────────
async function runAssist() {
  const box = $('#assist');
  box.innerHTML = '<div class="empty"><span class="spinner"></span> Reading this page…</div>';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
    if (tabId == null) throw new Error('No active tab.');
    // Not an Upwork tab (or a chrome:// page): don't inject anything, just show the hint.
    if (!/^https:\/\/([a-z0-9-]+\.)*upwork\.com\//i.test(tab.url || '')) { current = null; box.innerHTML = await emptyHint(); return; }
    const { autoFill } = await local('autoFill');
    if (autoFill !== false && /\/proposals\/.*apply/i.test(tab.url || '')) box.innerHTML = '<div class="empty"><span class="spinner"></span> Reading the proposal form, drafting and filling…</div>';
    current = await send('ASSIST', { tabId });
    renderAssist();
  } catch (e) {
    box.innerHTML = `<div class="banner warn">${esc(e.message)}</div>${await emptyHint()}`;
  }
}

async function emptyHint() {
  const { jobs = {} } = await local('jobs');
  const ready = Object.values(jobs).filter(j => j.status === 'drafted' || j.status === 'filled').length;
  return `<div class="empty"><p><strong>Open an Upwork job, then click the icon.</strong></p>
    <p class="small">On the job feed you get every visible job scored, best first. On a job page you get a score and a draft. On its proposal page (after <em>Apply now</em>) the draft is filled into the form for you to review and submit.</p>
    ${ready ? `<p class="small"><button class="link" data-goto="jobs">${ready} draft${ready === 1 ? '' : 's'} ready to submit →</button></p>` : ''}</div>`;
}

function scoreClass(s) { return s >= 65 ? 'hi' : s >= 45 ? 'mid' : 'lo'; }

function jobMeta(job) {
  const age = currentAge(job);
  const pay = job.jobType === 'fixed' ? `Fixed${job.budget ? ` $${job.budget}` : ''}`
    : job.jobType === 'hourly' ? `Hourly${job.hourlyMin ? ` $${job.hourlyMin}–$${job.hourlyMax}` : ''}` : '';
  return [pay, job.experience && job.experience[0].toUpperCase() + job.experience.slice(1), age != null ? `posted ${fmtAge(age)} ago` : job.postedOn && `posted ${job.postedOn}`,
    job.proposals && `${job.proposals} proposals`, job.interviewing != null && `${job.interviewing} interviewing`, job.connects != null && `${job.connects} Connects`]
    .filter(Boolean).join(' · ');
}

function clientKv(c = {}) {
  const rows = [
    ['Payment', c.paymentVerified == null ? null : c.paymentVerified ? 'verified' : 'not verified'],
    ['Spent', c.totalSpent != null ? `$${c.totalSpent.toLocaleString()}` : null],
    ['Hires', c.hires != null ? `${c.hires}${c.hireRate != null ? ` · ${c.hireRate}% hire rate` : ''}` : c.hireRate != null ? `${c.hireRate}% hire rate` : null],
    ['Rating', c.rating != null ? `${c.rating}${c.reviews != null ? ` (${c.reviews} reviews)` : ''}` : null],
    ['Avg paid', c.avgHourlyPaid != null ? `$${c.avgHourlyPaid}/hr` : null],
    ['Country', c.country], ['Member since', c.memberSince],
  ].filter(r => r[1] != null);
  return rows.length ? `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
    : '<p class="small muted" style="margin-top:6px">No client details on this page.</p>';
}

function renderAssist() {
  const box = $('#assist');
  const r = current;
  if (r?.blocked) {
    box.innerHTML = `<div class="banner bad"><strong>Stopped.</strong> Upwork is showing ${r.blocked === 'login' ? 'a login page' : 'a verification or challenge page'}. Nothing was read or filled. Deal with it in the tab yourself, then click the icon again.</div>`;
    return;
  }
  if (r?.kind === 'feed') { renderFeed(r); return; }
  if (!r || r.kind === 'other' || !r.job) { emptyHint().then(h => { box.innerHTML = h; }); return; }
  const job = r.job, d = job.draft, sc = job.score || { score: 0, reasons: [], scams: [], misses: [] };
  const banners = [];
  if (r.fill?.ok) banners.push(`<div class="banner good"><strong>Filled</strong> ${esc(fillSummary(r.fill))}. Review it${d?.duration ? `, set the duration to <strong>${esc(d.duration)}</strong>` : ''}${r.fill.viaMilestone ? ', pick the milestone due date' : ''}, and click <strong>Submit</strong> yourself.</div>`);
  else if (r.fill && !r.fill.ok) banners.push(`<div class="banner warn">${esc(r.fill.error || 'Nothing was filled.')}</div>`);
  if (sc.scams.length) banners.push(`<div class="banner bad"><strong>Possible scam:</strong> ${esc(sc.scams.join('; '))}.</div>`);
  if (d?.assessment?.risk >= 0.6) banners.push(`<div class="banner bad"><strong>AI risk ${Math.round(d.assessment.risk * 100)}%:</strong> ${esc(d.assessment.flags.join('; ') || 'see the brief')}.</div>`);
  if (sc.misses.length) banners.push(`<div class="banner warn"><strong>Outside your filters:</strong> ${esc(sc.misses.join(', '))}.</div>`);
  if (job.qualificationMisses?.length) banners.push(`<div class="banner warn"><strong>The client will see you don't meet:</strong> ${esc(job.qualificationMisses.join('; '))}.</div>`);
  if (job.descriptionTruncated && !d) banners.push('<div class="banner info">Only the start of the brief is on this page. For a better draft, open the job page first, click the icon there, then come back to <em>Apply</em>.</div>');

  box.innerHTML = `${banners.join('')}
    <div class="card">
      <div class="row" style="align-items:flex-start">
        <div class="score ${scoreClass(sc.score)}" title="Rule-based score — see the reasons below">${sc.score}</div>
        <div class="grow">
          <h2>${job.url ? `<a href="${esc(job.url)}" target="_blank" rel="noopener">${esc(job.title || 'Untitled job')}</a>` : esc(job.title || 'Untitled job')}</h2>
          <div class="meta">${esc(jobMeta(job)) || 'No job details on this page.'}</div>
        </div>
      </div>
      <div class="chips">${sc.reasons.map(x => `<span class="chip ${x.tone}">${x.pts > 0 ? '+' : ''}${x.pts} ${esc(x.text)}</span>`).join('')}</div>
      <details><summary>Client</summary>${clientKv(job.client)}</details>
      <div class="row spread" style="margin-top:12px">
        <div class="row">${actionButtons(r.kind, d)}</div>
        <select id="status" style="width:auto" aria-label="Status">${STATUSES.map(s => `<option value="${s}"${s === job.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
      </div>
      ${r.kind === 'apply' ? '<label class="check small" style="margin:8px 0 0"><input type="checkbox" id="overwrite"> <span>Replace text already in the form</span></label>'
        : '<p class="small muted" style="margin-top:8px">Draft here, then click <em>Apply now</em> on Upwork and click the icon again to fill the form.</p>'}
    </div>
    ${d ? draftCard(d, job) : ''}`;
  wireAssist(job);
}

// ── Feed: every job tile on the page you opened, best first ──
let hideMisses = false;
try { hideMisses = localStorage.getItem('hideFeedMisses') === '1'; } catch (_) {}

function renderFeed(r) {
  const box = $('#assist');
  const items = r.items || [];
  if (!items.length) { box.innerHTML = '<div class="banner warn">No job tiles found on this page. Send a page snapshot (Settings → Diagnostics) so the feed reader can be fixed.</div>'; return; }
  const shown = hideMisses ? items.filter(i => !i.score.misses.length && !i.score.scams.length) : items;
  const pay = i => i.jobType === 'fixed' ? `Fixed${i.budget ? ` $${i.budget.toLocaleString()}` : ''}` : i.jobType === 'hourly' ? `Hourly${i.hourlyMin ? ` $${i.hourlyMin}–$${i.hourlyMax}` : ''}` : '';
  const age = i => { const a = currentAge(i); return a != null ? `${fmtAge(a)} ago` : ''; };
  const client = c => [c.paymentVerified === true ? 'verified' : c.paymentVerified === false ? 'unverified' : '', c.totalSpent != null ? `$${c.totalSpent >= 1000 ? `${Math.round(c.totalSpent / 1000)}K` : c.totalSpent} spent` : '', c.rating ? `★${c.rating}` : '', c.country || ''].filter(Boolean).join(' · ');
  box.innerHTML = `
    <div class="row spread" style="margin-bottom:8px">
      <span class="small muted">${items.length} job${items.length === 1 ? '' : 's'} on this page, best first${hideMisses ? ` · ${items.length - shown.length} hidden` : ''}</span>
      <label class="check small" style="margin:0"><input type="checkbox" id="hide-misses"${hideMisses ? ' checked' : ''}> <span>Hide misses</span></label>
    </div>
    <div class="card" style="padding:4px 12px">${shown.map(i => `
      <div class="job-row">
        <div class="row" style="align-items:flex-start">
          <div class="score ${scoreClass(i.score.score)}" style="min-width:36px;height:36px;font-size:14px;border-radius:8px">${i.score.score}</div>
          <div class="grow">
            ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener" style="font-weight:600">${esc(i.title)}</a>` : `<strong>${esc(i.title)}</strong>`}
            ${i.status ? ` <span class="pill ${esc(i.status)}">${esc(STATUS_LABEL[i.status] || i.status)}</span>` : ''}
            <div class="meta">${esc([pay(i), age(i), i.proposals && `${i.proposals} proposals`, client(i.client)].filter(Boolean).join(' · '))}</div>
            ${i.score.scams.length ? `<div class="small" style="color:var(--bad);margin-top:3px">⚠ ${esc(i.score.scams.join('; '))}</div>` : ''}
            ${i.score.misses.length ? `<div class="small" style="color:var(--warn);margin-top:3px">Outside filters: ${esc(i.score.misses.join(', '))}</div>` : ''}
          </div>
        </div>
      </div>`).join('') || '<div class="empty small">Every job here is outside your filters.</div>'}</div>
    <p class="small muted">Open a job, then click the icon on it to draft. Only the jobs already on this page are scored — nothing is loaded or refreshed.</p>`;
  box.querySelector('#hide-misses').addEventListener('change', e => {
    hideMisses = e.target.checked;
    try { localStorage.setItem('hideFeedMisses', hideMisses ? '1' : '0'); } catch (_) {}
    renderFeed(r);
  });
}

function actionButtons(kind, d) {
  const draft = `<button class="btn${d ? '' : ' primary'}" id="draft">${d ? 'Redraft' : 'Draft proposal'}</button>`;
  return kind === 'apply' ? `<button class="btn primary" id="fill"${d ? '' : ' disabled'}>Fill form</button>${draft}` : draft;
}

function fillSummary(f) {
  const done = f.done || [];
  const q = done.filter(x => /^q\d+$/.test(x)).length;
  return [done.includes('cover') && 'the cover letter', (q || f.unanswered) && `${q} of ${q + (f.unanswered || 0)} answers`,
    done.includes('rate') && (f.viaMilestone ? 'the milestone amount' : 'the rate'), done.includes('milestone') && 'its description'].filter(Boolean).join(', ') || 'nothing';
}

function draftCard(d, job) {
  const notes = [];
  if (d.fell) notes.push(`<div class="banner warn">${d.fell === 'no_key' ? 'No AI key set — this is the template.' : 'The AI failed, so this is the template.'} Replace the [bracketed] parts before sending.</div>`);
  else if (d.placeholders?.length) notes.push(`<div class="banner warn">Fill in before sending: ${esc(d.placeholders.join(', '))}</div>`);
  if (d.banned?.length) notes.push(`<div class="banner info">Contains phrases you asked to avoid: ${esc(d.banned.join(', '))}</div>`);
  const a = d.assessment;
  const qs = d.questions || [];
  return `<div class="card">
    ${notes.join('')}
    <div class="row spread">
      <h3 style="margin:0">Draft</h3>
      <span class="small muted">${d.words || 0} words${d.source === 'ai' ? ` · ${esc(d.provider || 'AI')}` : ' · template'}${d.edited ? ' · edited' : ''}</span>
    </div>
    <div class="grid2" style="margin-top:8px">
      <label class="field"><span>${d.unit === 'hourly' ? 'Rate ($/hr)' : d.unit === 'fixed' ? 'Bid ($)' : 'Rate / bid ($)'}</span><input type="number" id="d-rate" min="0" step="1" value="${d.rate || ''}" placeholder="not set"></label>
      <label class="field"><span>Duration (set on Upwork)</span><input type="text" value="${esc(d.duration || '—')}" readonly></label>
    </div>
    ${d.milestone ? `<p class="small muted" style="margin:-4px 0 8px">Milestone: ${esc(d.milestone)}</p>` : ''}
    <div class="row spread"><span class="q" style="margin:0">Cover letter</span><button class="btn small" data-copy="cover">Copy</button></div>
    <textarea id="d-cover" rows="11" style="margin-top:4px">${esc(d.coverLetter)}</textarea>
    ${qs.map((q, i) => `<div class="row spread" style="margin-top:8px"><span class="q grow" style="margin:0">${i + 1}. ${esc(q)}</span><button class="btn small" data-copy="a${i}">Copy</button></div>
      <textarea class="d-ans" data-i="${i}" rows="3" style="margin-top:4px">${esc(d.answers?.[i] || '')}</textarea>`).join('')}
    ${a && a.fit != null ? `<p class="small muted" style="margin-top:8px">AI read of the job: fit ${Math.round(a.fit * 100)}% · clarity ${Math.round((a.clarity ?? 0) * 100)}% · risk ${Math.round((a.risk ?? 0) * 100)}%</p>` : ''}
  </div>`;
}

function wireAssist(job) {
  const box = $('#assist');
  box.querySelector('#draft')?.addEventListener('click', () => act(async () => {
    $('#draft').innerHTML = '<span class="spinner"></span> Drafting…';
    const rec = await send('DRAFT', { jobId: job.id });
    current = { ...current, job: rec, fill: null };
  }));
  box.querySelector('#fill')?.addEventListener('click', () => act(async () => {
    const fill = await send('FILL', { jobId: job.id, tabId, overwrite: $('#overwrite')?.checked });
    const rec = (await local('jobs')).jobs?.[job.id];
    current = { ...current, job: rec || current.job, fill: fill.blocked ? null : fill, blocked: fill.blocked };
  }));
  box.querySelector('#status')?.addEventListener('change', e => act(async () => {
    current = { ...current, job: await send('SET_STATUS', { jobId: job.id, status: e.target.value }) };
    toast(`Marked ${STATUS_LABEL[e.target.value]}`);
  }));
  const save = () => send('SAVE_DRAFT', {
    jobId: job.id, coverLetter: $('#d-cover').value,
    answers: [...box.querySelectorAll('.d-ans')].map(t => t.value),
    rate: $('#d-rate').value === '' ? null : Number($('#d-rate').value),
  }).then(rec => { if (rec) current.job = rec; }).catch(e => toast(e.message));
  box.querySelectorAll('#d-cover, .d-ans, #d-rate').forEach(el => el.addEventListener('change', save));
  box.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.copy;
    copy(k === 'cover' ? $('#d-cover').value : box.querySelector(`.d-ans[data-i="${k.slice(1)}"]`).value);
  }));
}

async function act(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('#assist button').forEach(b => { b.disabled = true; });
  try { await fn(); } catch (e) { toast(e.message); }
  busy = false;
  renderAssist();
}

document.addEventListener('click', e => { const g = e.target.closest('[data-goto]'); if (g) showTab(g.dataset.goto); });

// ─────────────────────────────────────────────────────────────
// Jobs
// ─────────────────────────────────────────────────────────────
async function renderJobs() {
  const { jobs = {} } = await local('jobs');
  const all = Object.values(jobs).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const count = f => all.filter(f).length;
  $('#stats').innerHTML = [
    ['Ready', count(j => j.status === 'drafted' || j.status === 'filled')],
    ['Submitted', count(j => STATUSES.indexOf(j.status) >= STATUSES.indexOf('submitted'))],
    ['Replies', count(j => ['viewed', 'interview', 'offer', 'hired'].includes(j.status))],
    ['Hired', count(j => j.status === 'hired')],
  ].map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
  const f = $('#jobs-filter').value;
  const list = all.filter(j => !f || (f === 'ready' ? ['drafted', 'filled'].includes(j.status) : f === 'submitted' ? j.status === 'submitted' : OUTCOME_STATUSES.includes(j.status)));
  $('#jobs').innerHTML = list.length ? list.map(j => `
    <div class="job-row" data-id="${esc(j.id)}">
      <div class="row spread">
        <a class="grow" href="${esc(j.url || j.applyUrl || '#')}" target="_blank" rel="noopener" style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(j.title || j.id)}</a>
        <span class="pill">${j.score?.score ?? '–'}</span>
      </div>
      <div class="row spread small muted" style="margin-top:4px">
        <span>${esc(STATUS_LABEL[j.status] || j.status)} · ${fmtAge(Math.round((Date.now() - (j.statusAt || j.updatedAt || Date.now())) / 60000))} ago${j.draft ? ` · draft ${j.draft.source === 'ai' ? 'ready' : '(template)'}` : ''}</span>
        <span class="row">
          <select class="j-status" style="width:auto;padding:2px 4px;font-size:11px" aria-label="Status">${STATUSES.map(s => `<option value="${s}"${s === j.status ? ' selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
          ${j.draft ? '<button class="btn small j-copy" title="Copy the cover letter">Copy</button>' : ''}
          <button class="btn small j-del" title="Delete">✕</button>
        </span>
      </div>
    </div>`).join('') : '<div class="empty small">Nothing here yet. Jobs you open with the assistant are listed here, newest first. Set the status as replies come in — those labels train the model in a later version.</div>';
  $('#jobs').querySelectorAll('.job-row').forEach(row => {
    const id = row.dataset.id;
    row.querySelector('.j-status').addEventListener('change', e => send('SET_STATUS', { jobId: id, status: e.target.value }).then(renderJobs));
    row.querySelector('.j-copy')?.addEventListener('click', () => copy(jobs[id].draft.coverLetter));
    row.querySelector('.j-del').addEventListener('click', () => { if (confirm('Delete this job and its draft?')) send('DELETE_JOB', { jobId: id }).then(renderJobs); });
  });
}
$('#jobs-filter').addEventListener('change', renderJobs);
$('#export-jobs').addEventListener('click', async () => {
  const { jobs = {} } = await local('jobs');
  download(`proposal-assistant-jobs-${new Date().toISOString().slice(0, 10)}.json`, { exportedAt: new Date().toISOString(), jobs });
});

function download(name, obj) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ─────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────
const form = $('#settings');
const csv = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

async function loadSettings() {
  const d = await local([...SETTINGS_KEYS, 'keysInSession']);
  const sess = chrome.storage.session ? await chrome.storage.session.get(SECRET_KEYS) : {};
  const s = { ...SETTINGS_DEFAULTS, ...d };
  const f = { ...FILTER_DEFAULTS, ...(d.filters || {}) };
  for (const k of ['aiProvider', 'geminiModel', 'openrouterModel', 'profileSkills', 'hourlyRate', 'hourlyStrategy', 'minFixedBid']) form.elements[k].value = s[k] ?? '';
  form.elements.geminiApiKey.value = sess.geminiApiKey || s.geminiApiKey || '';
  form.elements.openrouterApiKey.value = sess.openrouterApiKey || s.openrouterApiKey || '';
  $('#session-keys').checked = !!d.keysInSession;
  form.elements.fixedBidPct.value = Math.round((Number(s.fixedBidRatio) || 1) * 100);
  form.elements.autoFill.checked = s.autoFill !== false;
  form.elements.fillRate.checked = s.fillRate !== false;
  for (const [k, v] of Object.entries(f)) {
    if (Array.isArray(v) && (k === 'jobTypes' || k === 'experience')) form.querySelectorAll(`[name="f_${k}"]`).forEach(c => { c.checked = v.includes(c.value); });
    else if (Array.isArray(v)) form.elements[`f_${k}`].value = v.join(', ');
    else if (typeof v === 'boolean') form.elements[`f_${k}`].checked = v;
    else form.elements[`f_${k}`].value = v || '';
  }
  validateKeys({ geminiApiKey: form.elements.geminiApiKey.value, openrouterApiKey: form.elements.openrouterApiKey.value });   // flag a bad key that's already saved
}

function readSettingsForm() {
  const n = name => Number(form.elements[name].value) || 0;
  const filters = {};
  for (const [k, def] of Object.entries(FILTER_DEFAULTS)) {
    if (k === 'jobTypes' || k === 'experience') filters[k] = [...form.querySelectorAll(`[name="f_${k}"]:checked`)].map(c => c.value);
    else if (Array.isArray(def)) filters[k] = csv(form.elements[`f_${k}`].value);
    else if (typeof def === 'boolean') filters[k] = form.elements[`f_${k}`].checked;
    else if (typeof def === 'number') filters[k] = n(`f_${k}`);
    else filters[k] = form.elements[`f_${k}`].value;
  }
  return {
    aiProvider: form.elements.aiProvider.value,
    geminiApiKey: form.elements.geminiApiKey.value.trim(), geminiModel: form.elements.geminiModel.value.trim() || SETTINGS_DEFAULTS.geminiModel,
    openrouterApiKey: form.elements.openrouterApiKey.value.trim(), openrouterModel: form.elements.openrouterModel.value.trim() || SETTINGS_DEFAULTS.openrouterModel,
    profileSkills: csv(form.elements.profileSkills.value).join(', '),
    hourlyRate: n('hourlyRate'), hourlyStrategy: form.elements.hourlyStrategy.value,
    fixedBidRatio: Math.max(0.1, n('fixedBidPct') / 100 || 1), minFixedBid: n('minFixedBid'),
    autoFill: form.elements.autoFill.checked, fillRate: form.elements.fillRate.checked,
    filters,
  };
}

// Wrong-kind or malformed keys are caught here, next to the field, instead of as a confusing
// 401 from the provider later. Returns false (and shows why) when a key can't be used.
function validateKeys(s) {
  const errs = [];
  for (const [p, name] of [['gemini', 'geminiApiKey'], ['openrouter', 'openrouterApiKey']]) {
    const { key, error } = checkKey(p, s[name]);
    s[name] = key;
    form.elements[name].value = key;
    form.elements[name].classList.toggle('invalid', !!error);
    if (error) errs.push(error);
  }
  const box = $('#key-error');
  box.textContent = errs.join(' ');
  box.hidden = !errs.length;
  return !errs.length;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  const s = readSettingsForm();
  if (!validateKeys(s)) { toast('Not saved — check the API key'); $('#key-error').scrollIntoView?.({ block: 'center' }); return; }
  const inSession = $('#session-keys').checked && !!chrome.storage.session;
  const secrets = Object.fromEntries(SECRET_KEYS.map(k => [k, s[k]]));
  if (inSession) {
    await chrome.storage.session.set(secrets);
    for (const k of SECRET_KEYS) s[k] = '';
  } else if (chrome.storage.session) {
    await chrome.storage.session.remove(SECRET_KEYS);
  }
  await chrome.storage.local.set({ ...s, keysInSession: inSession });
  await send('RESCORE_ALL').catch(() => {});
  toast('Saved');
  if (current?.job) { current.job = (await local('jobs')).jobs?.[current.job.id] || current.job; renderAssist(); }
});

$('#test-ai').addEventListener('click', async () => {
  const s = readSettingsForm();
  const provider = s.aiProvider;
  const out = $('#test-ai-out');
  if (!validateKeys(s)) { out.textContent = ''; return; }
  const key = provider === 'openrouter' ? s.openrouterApiKey : s.geminiApiKey;
  if (!key) { out.textContent = `Enter ${provider === 'openrouter' ? 'an OpenRouter' : 'a Gemini'} key first.`; return; }
  out.innerHTML = '<span class="spinner"></span>';
  const r = await send('TEST_AI', { provider, key, model: provider === 'openrouter' ? s.openrouterModel : s.geminiModel }).catch(e => ({ ok: false, error: e.message }));
  out.textContent = r.ok ? `Connected (${provider})` : r.error;
});

$('#export-settings').addEventListener('click', async () => {
  const d = await local(EXPORT_KEYS);
  download('proposal-assistant-settings.json', { exportedAt: new Date().toISOString(), settings: d });
});
$('#import-settings').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  try {
    const j = JSON.parse(await e.target.files[0].text());
    const s = Object.fromEntries(Object.entries(j.settings || j).filter(([k]) => EXPORT_KEYS.includes(k)));   // keys are never imported
    await chrome.storage.local.set(s);
    await loadSettings();
    toast(`Imported ${Object.keys(s).length} settings`);
  } catch (err) { toast(`Import failed: ${err.message}`); }
  e.target.value = '';
});

$('#snapshot').addEventListener('click', async () => {
  try {
    if (tabId == null) throw new Error('No active tab.');
    copy(JSON.stringify(await send('SNAPSHOT', { tabId }), null, 2));
  } catch (e) { toast(e.message); }
});

// ─────────────────────────────────────────────────────────────
// Log
// ─────────────────────────────────────────────────────────────
let logEntries = [];
function renderLog() {
  const lvl = $('#log-level').value;
  const keep = e => !lvl || (lvl === 'warn' ? e.type === 'warn' || e.type === 'error' : e.type === 'error');
  let lastDay = '';
  const html = [];
  for (const e of logEntries.filter(keep)) {
    const d = new Date(e.ts);
    const day = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    if (day !== lastDay) { html.push(`<div class="day">${esc(day)}</div>`); lastDay = day; }
    html.push(`<div class="e ${esc(e.type)}"><time>${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>${esc(e.msg)}</div>`);
  }
  $('#log').innerHTML = html.join('') || '<div class="empty small">No activity yet.</div>';
  const main = document.querySelector('main'); main.scrollTop = main.scrollHeight;
}
$('#log-level').addEventListener('change', renderLog);
$('#log-copy').addEventListener('click', () => copy(logEntries.map(e => `${new Date(e.ts).toLocaleString()} [${e.type}] ${e.msg}`).join('\n')));
$('#log-clear').addEventListener('click', async () => { await send('CLEAR_LOG').catch(() => {}); logEntries = (await local('activityLog')).activityLog || []; renderLog(); });
chrome.runtime.onMessage.addListener(m => {
  if (m?.type === 'LOG') { logEntries.push(m.entry); logEntries = logEntries.slice(-500); if (!$('#tab-log').hidden) renderLog(); }
});

// ── Boot ──
(async () => {
  $('#ver').textContent = `v${chrome.runtime.getManifest().version}`;
  logEntries = (await local('activityLog')).activityLog || [];
  await loadSettings();
  runAssist();
})();
