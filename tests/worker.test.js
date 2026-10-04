// End to end: the real worker + the real pageAgent running on jsdom pages + a Gemini double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installChrome, installFetch, makePage, geminiReply, jsonRes } from './_chrome.js';

const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const ID = '~021234567890123456789';
const JOB_URL = `https://www.upwork.com/jobs/${ID}`;
const APPLY_URL = `https://www.upwork.com/ab/proposals/job/${ID}/apply/`;

const env = installChrome();
const { store, session, message, executed, setPage } = env;
let aiReply = null, fetchCalls = installFetch(async url => {
  if (url.includes('generativelanguage.googleapis.com')) return aiReply;
  throw new Error(`unexpected fetch ${url}`);
});
await import('../background.js');
const { _resetLimits } = await import('../bg/ai.js');
const { whenLogged } = await import('../bg/log.js');
const settle = async () => { await new Promise(r => setTimeout(r, 0)); await whenLogged(); };
const logText = () => (store.activityLog || []).map(e => `[${e.type}] ${e.msg}`).join('\n');

function reset(settings = {}) {
  for (const k of Object.keys(store)) delete store[k];
  for (const k of Object.keys(session)) delete session[k];
  Object.assign(store, { geminiApiKey: 'k', profileSkills: 'WooCommerce, PHP, WordPress', hourlyRate: 45, ...settings });
  executed.length = 0; fetchCalls.length = 0; _resetLimits();
  aiReply = geminiReply({
    cover_letter: 'Hi,\n\nZone first: your checkout loses the shipping zone on postcode edits, only with Table Rate active. I fix WooCommerce checkout logic.\n\nI would reproduce it on staging, trace update_order_review, and patch the rates filter in a small plugin.\n\n$45/hr, about 4 hours.\n\nWhich Table Rate version are you on?',
    answers: ['Yes, many times.', 'I can start tomorrow.'], duration: 'Less than 1 month', assessment: { fit: 0.9, clarity: 0.8, risk: 0.05, flags: [] },
  });
}

test('without a click there is no page access, and the error says to click the icon', async () => {
  reset(); setPage(null);
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.ok, false);
  assert.match(r.error, /click its icon/);
});

test('job page: reads and scores only — no AI call until you ask', async () => {
  reset(); setPage(makePage(fx('job-page.html'), JOB_URL));
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.kind, 'job');
  const job = store.jobs[ID];
  assert.equal(job.status, 'read');
  assert.equal(job.title, 'Fix WooCommerce checkout losing shipping zone');
  assert.ok(job.score.score >= 80, `score ${job.score.score}`);
  assert.ok(job.postedAt <= Date.now() - 25 * 60000 + 1000);
  assert.equal(fetchCalls.length, 0);
  await settle();
  assert.match(logText(), /Read job: "Fix WooCommerce checkout losing shipping zone" — score \d+/);
});

test('draft on the job page uses the screening questions from the job page, then the proposal page auto-fills', async () => {
  reset(); setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  const d = await message({ type: 'DRAFT', jobId: ID });
  assert.equal(d.ok, true, d.error);
  assert.equal(fetchCalls.length, 1);
  const body = JSON.parse(fetchCalls[0].init.body);
  assert.equal(fetchCalls[0].init.headers['x-goog-api-key'], 'k');            // key in a header, not the URL
  assert.ok(!fetchCalls[0].url.includes('key='));
  const prompt = body.contents[0].parts[0].text;
  assert.match(prompt, /1\. Have you worked with WooCommerce Table Rate Shipping before\?/);
  assert.match(prompt, /Your rate: \$45\/hr/);
  assert.match(prompt, /start your proposal with the word "zone"/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(store.jobs[ID].status, 'drafted');

  // Now the proposal page: the draft already covers its questions, so no second AI call.
  const page = makePage(fx('apply-page.html'), APPLY_URL);
  setPage(page);
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.kind, 'apply');
  assert.equal(fetchCalls.length, 1);
  assert.match(page.doc.getElementById('cover').value, /^Hi,\n\nZone first/);
  assert.equal(page.doc.querySelector('[name=q1]').value, 'Yes, many times.');
  assert.equal(page.doc.querySelector('[name=q2]').value, 'I typed this myself');   // never replaced automatically
  assert.equal(page.doc.getElementById('rate').value, '45');
  assert.equal(page.clicks.length, 0);
  assert.equal(page.submits.length, 0);
  const job = store.jobs[ID];
  assert.equal(job.status, 'filled');
  assert.equal(job.rateAutoFilled, true);
  assert.equal(job.title, 'Fix WooCommerce checkout losing shipping zone');          // not "Submit a proposal"
  assert.equal(job.url, JOB_URL);
  assert.deepEqual(r.result.fill.done, ['cover', 'q1', 'rate']);
  await settle();
  assert.match(logText(), /Auto-filled "Fix WooCommerce checkout losing shipping zone": cover letter, 1\/2 answers, rate \$45 \(left alone: q2 — already has text\)\. Review, set the duration, and click Submit yourself\./);

  // Opening the popup again: the rate you may have changed is not set a second time.
  page.doc.getElementById('rate').value = '50';
  await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(page.doc.getElementById('rate').value, '50');
  // A manual Fill with "replace" overwrites your text and sets the rate.
  const f = await message({ type: 'FILL', jobId: ID, tabId: 7, overwrite: true });
  assert.equal(f.ok, true);
  assert.equal(page.doc.querySelector('[name=q2]').value, 'I can start tomorrow.');
  assert.equal(page.doc.getElementById('rate').value, '45');
  assert.equal(page.clicks.length + page.submits.length, 0);
});

test('straight to the proposal page: drafts with the form\'s questions and fills, in one click', async () => {
  reset(); setPage(makePage(fx('apply-page.html'), APPLY_URL));
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.ok, true, r.error);
  assert.equal(fetchCalls.length, 1);
  const prompt = JSON.parse(fetchCalls[0].init.body).contents[0].parts[0].text;
  assert.match(prompt, /1\. Have you worked with WooCommerce Table Rate Shipping before\?\n2\. How soon could you start\?/);
  assert.match(prompt, /Your rate: \$45\/hr/);                                       // job type inferred from the "Hourly Rate" field
  assert.equal(store.jobs[ID].jobType, 'hourly');
  assert.equal(store.jobs[ID].status, 'filled');
  assert.ok(store.jobs[ID].fallbackText.length > 20);                                 // no description hook → page text for the AI
});

test('real proposal page straight away, no rate in Settings: real title and brief go to the AI, profile rate is used, boost untouched', async () => {
  reset({ hourlyRate: 0 });
  const RID = '~022106883383762540293';
  const page = makePage(fx('apply-real-2026-10-04.html'), `https://www.upwork.com/nx/proposals/job/${RID}/apply/`);
  // jsdom has no innerText layout, so feed the agent the real captured text for mainText.
  const run = page.run;
  page.run = (func, args) => { const r = run(func, args); if (args[0] === 'read') r.mainText = fx('apply-real-2026-10-04.txt'); return r; };
  setPage(page);
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.ok, true, r.error);
  const job = store.jobs[RID];
  assert.equal(job.title, 'Malware cleanup on several websites');
  assert.equal(job.url, `https://www.upwork.com/jobs/${RID}`);
  const prompt = JSON.parse(fetchCalls[0].init.body).contents[0].parts[0].text;
  assert.match(prompt, /Job title: Malware cleanup on several websites/);
  assert.match(prompt, /Client's brief:\nSeveral client websites/);
  assert.match(prompt, /Your rate: \$30\/hr/);
  assert.ok(!/Bid to boost/.test(prompt));
  assert.equal(page.doc.querySelector('[aria-label="Hourly rate"]').value, '30');
  assert.equal(page.doc.querySelector('input[placeholder="Connects"]').value, '');
  assert.match(page.doc.getElementById('cover-letter-area').value, /^Hi,/);
});

test('auto-fill off: the proposal page is read, nothing drafted or filled', async () => {
  reset({ autoFill: false }); const page = makePage(fx('apply-page.html'), APPLY_URL); setPage(page);
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.result.kind, 'apply');
  assert.equal(fetchCalls.length, 0);
  assert.equal(page.doc.getElementById('cover').value, '');
});

test('challenge page: stops, logs, reads and fills nothing', async () => {
  reset(); setPage(makePage(fx('challenge.html'), APPLY_URL));
  const r = await message({ type: 'ASSIST', tabId: 7 });
  assert.equal(r.result.blocked, 'challenge');
  assert.equal(store.jobs, undefined);
  assert.equal(fetchCalls.length, 0);
  await settle();
  assert.match(logText(), /\[warn\] Stopped: Upwork is showing a verification \/ challenge page/);
});

test('AI failure or no key → template draft, logged', async () => {
  reset(); setPage(makePage(fx('job-page.html'), JOB_URL));
  aiReply = jsonRes({ error: { message: 'boom' } }, 500);
  await message({ type: 'ASSIST', tabId: 7 });
  const d = await message({ type: 'DRAFT', jobId: ID });
  assert.equal(d.result.draft.source, 'template');
  assert.equal(d.result.draft.fell, 'error');
  await settle();
  assert.match(logText(), /AI draft failed \(Gemini: boom\) — using the template instead\./);
  reset({ geminiApiKey: '' }); setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  const d2 = await message({ type: 'DRAFT', jobId: ID });
  assert.equal(d2.result.draft.fell, 'no_key');
  assert.equal(fetchCalls.length, 0);
});

test('OpenRouter selected with a Gemini key in its field: never sent, explained, Gemini used instead', async () => {
  reset({ aiProvider: 'openrouter', openrouterApiKey: 'AIzaSyWrongField', geminiApiKey: 'AIzaGood' }); setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  const d = await message({ type: 'DRAFT', jobId: ID });
  assert.equal(d.result.draft.source, 'ai');
  assert.equal(d.result.draft.provider, 'gemini');
  assert.ok(fetchCalls.every(c => !c.url.includes('openrouter.ai')));
  await settle();
  assert.match(logText(), /\[warn\] Not using the OpenRouter key: That isn't an OpenRouter key — it looks like a Google Gemini key/);
});

test('only a wrong-kind key: template, no request; a rejected OpenRouter key gets a plain explanation', async () => {
  reset({ aiProvider: 'openrouter', openrouterApiKey: 'AIzaSyWrongField', geminiApiKey: '' }); setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  const d = await message({ type: 'DRAFT', jobId: ID });
  assert.equal(d.result.draft.fell, 'no_key');
  assert.equal(fetchCalls.length, 0);
  const t = await message({ type: 'TEST_AI', provider: 'openrouter', key: 'AIzaSyWrongField', model: 'x' });
  assert.match(t.result.error, /isn't an OpenRouter key/);
  assert.equal(fetchCalls.length, 0);

  reset({ aiProvider: 'openrouter', openrouterApiKey: 'Bearer sk-or-v1-revoked', geminiApiKey: '' });
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { fetchCalls.push({ url, init }); return jsonRes({ error: { message: 'User not found.', code: 401 } }, 401); };
  setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  const d2 = await message({ type: 'DRAFT', jobId: ID });
  globalThis.fetch = prevFetch;
  assert.equal(fetchCalls[0].init.headers.Authorization, 'Bearer sk-or-v1-revoked');   // "Bearer " pasted with the key isn't doubled
  assert.equal(d2.result.draft.fell, 'auth');
  await settle();
  assert.match(logText(), /OpenRouter rejected the key \(User not found\.\) — check Settings → OpenRouter API key; it should start with "sk-or-v1-"/);
});

test('a raw-newline one-block reply is parsed, greeted and split', async () => {
  reset(); setPage(makePage(fx('job-page.html'), JOB_URL));
  aiReply = geminiReply('{"cover_letter": "Zone first, your checkout drops the zone. I fix this. I trace update_order_review. Then I patch the filter. $45/hr for 4 hours. Which version?", "answers": ["Yes", "Tomorrow"]}');
  await message({ type: 'ASSIST', tabId: 7 });
  const d = await message({ type: 'DRAFT', jobId: ID });
  assert.match(d.result.draft.coverLetter, /^Hi,\n\nZone first/);
  assert.ok(d.result.draft.coverLetter.split('\n\n').length >= 3);
});

test('status, edits and delete', async () => {
  reset(); setPage(makePage(fx('job-page.html'), JOB_URL));
  await message({ type: 'ASSIST', tabId: 7 });
  await message({ type: 'DRAFT', jobId: ID });
  await message({ type: 'SAVE_DRAFT', jobId: ID, coverLetter: 'Hi,\n\nMine.', answers: ['a', 'b'], rate: 47.6 });
  assert.equal(store.jobs[ID].draft.coverLetter, 'Hi,\n\nMine.');
  assert.equal(store.jobs[ID].draft.rate, 48);
  assert.equal((await message({ type: 'SET_STATUS', jobId: ID, status: 'interview' })).result.status, 'interview');
  assert.equal((await message({ type: 'SET_STATUS', jobId: ID, status: 'nope' })).ok, false);
  await message({ type: 'DELETE_JOB', jobId: ID });
  assert.equal(store.jobs[ID], undefined);
});

test('the manifest cannot reach Upwork on its own', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(!m.host_permissions.some(h => /upwork/i.test(h)));
  assert.ok(m.permissions.includes('activeTab'));
  for (const p of ['alarms', 'tabs', 'webRequest', 'cookies', 'debugger', 'declarativeNetRequest']) assert.ok(!m.permissions.includes(p), p);
  assert.equal(m.content_scripts, undefined);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, m.version);
  for (const f of ['background.js', 'bg/ai.js', 'bg/proposal.js', 'shared/parse.js', 'page/agent.js'])
    assert.ok(!/\.click\(\)|requestSubmit|\.submit\(\)|setInterval|chrome\.alarms/.test(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')), f);
});
