import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makePage } from './_chrome.js';
import { pageAgent } from '../page/agent.js';
import { classifyFields, buildFillItems, questionText } from '../shared/form.js';

const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const APPLY = 'https://www.upwork.com/ab/proposals/job/~021234567890123456789/apply/';

test('reads the proposal form: labels, visible fields only, no typed text', () => {
  const page = makePage(fx('apply-page.html'), APPLY);
  const read = page.run(pageAgent, ['read', null]);
  const labels = read.fields.map(f => f.label);
  assert.deepEqual(labels, ['Hourly Rate', "You'll Receive", 'Cover Letter', 'Have you worked with WooCommerce Table Rate Shipping before?', 'How soon could you start?']);
  assert.ok(!read.fields.some(f => f.label === 'Attachments'));           // file input ignored
  const q2 = read.fields[4];
  assert.equal(q2.hasValue, true);
  assert.equal(q2.value, '');                                              // textarea contents are never returned
  assert.equal(read.fields[0].value, '40.00');                             // inputs are (the rate)
});

test('classifies cover letter, questions and rate (not "You\'ll receive")', () => {
  const page = makePage(fx('apply-page.html'), APPLY);
  const form = classifyFields(page.run(pageAgent, ['read', null]).fields);
  assert.equal(form.cover.label, 'Cover Letter');
  assert.deepEqual(form.questions.map(q => q.text), ['Have you worked with WooCommerce Table Rate Shipping before?', 'How soon could you start?']);
  assert.equal(form.rate.label, 'Hourly Rate');
  assert.equal(questionText('What is your rate? 0/5000 characters'), 'What is your rate?');
});

test('fill: sets values with input/change events, keeps text you typed, never clicks or submits', () => {
  const page = makePage(fx('apply-page.html'), APPLY);
  const form = classifyFields(page.run(pageAgent, ['read', null]).fields);
  const draft = { coverLetter: 'Hi,\n\nCover.', answers: ['Yes, often.', 'Tomorrow.'], rate: 45 };
  const items = buildFillItems(form, draft, { fillRate: true, auto: true });
  const { results } = page.run(pageAgent, ['fill', { items }]);
  const d = page.doc;
  assert.equal(d.getElementById('cover').value, 'Hi,\n\nCover.');
  assert.equal(d.querySelector('[name=q1]').value, 'Yes, often.');
  assert.equal(d.querySelector('[name=q2]').value, 'I typed this myself');
  assert.equal(d.getElementById('rate').value, '45');
  assert.equal(d.getElementById('receive').value, '36.00');
  assert.deepEqual(results.map(r => [r.role, r.ok, r.reason]), [['cover', true, undefined], ['q1', true, undefined], ['q2', false, 'already has text'], ['rate', true, undefined]]);
  assert.ok(page.events.some(e => e.type === 'input' && e.name === 'cover'));
  assert.ok(page.events.some(e => e.type === 'change' && e.name === 'rate'));
  assert.equal(page.clicks.length, 0);
  assert.equal(page.submits.length, 0);
});

test('fill: overwrite (manual) replaces typed text; automatic never does; rate only once when automatic', () => {
  const page = makePage(fx('apply-page.html'), APPLY);
  const form = classifyFields(page.run(pageAgent, ['read', null]).fields);
  const draft = { coverLetter: 'C', answers: ['A1', 'A2'], rate: 45 };
  assert.ok(buildFillItems(form, draft, { overwrite: true, auto: true }).every(i => i.role === 'rate' || !i.overwrite));
  assert.ok(!buildFillItems(form, draft, { auto: true, rateAlreadyAutoFilled: true }).some(i => i.role === 'rate'));
  assert.ok(!buildFillItems(form, draft, { fillRate: false }).some(i => i.role === 'rate'));
  page.run(pageAgent, ['fill', { items: buildFillItems(form, draft, { overwrite: true }) }]);
  assert.equal(page.doc.querySelector('[name=q2]').value, 'A2');
});

test('fill: re-finds a field by label after a re-render, and reports a missing one', () => {
  const page = makePage(fx('apply-page.html'), APPLY);
  const items = [{ role: 'cover', index: 0, label: 'Cover Letter', value: 'X' }, { role: 'q9', index: 99, label: 'Gone?', value: 'Y' }];
  const { results } = page.run(pageAgent, ['fill', { items }]);
  assert.equal(page.doc.getElementById('cover').value, 'X');
  assert.equal(page.doc.getElementById('rate').value, '40.00');
  assert.deepEqual(results.map(r => r.ok), [true, false]);
});

test('challenge and login pages are detected; a brief that mentions captcha is not', () => {
  const ch = makePage(fx('challenge.html'), 'https://www.upwork.com/jobs/~021234567890123456789');
  assert.equal(ch.run(pageAgent, ['read', null]).blocked, 'challenge');
  const login = makePage('<main><h1>Log in to Upwork</h1><input name="u"></main>', 'https://www.upwork.com/ab/account-security/login');
  assert.equal(login.run(pageAgent, ['read', null]).blocked, 'login');
  const long = 'We need someone to integrate a captcha on our signup form. '.repeat(60);
  const ok = makePage(`<main><h1>Add captcha</h1><div data-test="Description">${long}</div></main>`, 'https://www.upwork.com/jobs/~021234567890123456789');
  assert.equal(ok.run(pageAgent, ['read', null]).blocked, null);
});

test('real proposal page (captured 2026-10-04): the Connects boost bid is never classified or filled', () => {
  const page = makePage(fx('apply-real-2026-10-04.html'), 'https://www.upwork.com/nx/proposals/job/~022106883383762540293/apply/');
  const read = page.run(pageAgent, ['read', null]);
  assert.deepEqual(read.fields.map(f => f.label), ['Hourly rate', "You'll receive", 'Cover Letter', 'Bid 101 Connects or higher to be ranked in 1st place.']);
  const form = classifyFields(read.fields);
  assert.equal(form.cover.label, 'Cover Letter');
  assert.equal(form.rate.label, 'Hourly rate');
  assert.deepEqual(form.questions, []);
  const items = buildFillItems(form, { coverLetter: 'Hi,\n\nX.', answers: [], rate: 30 }, { fillRate: true });
  assert.deepEqual(items.map(i => i.role), ['cover', 'rate']);
  // Even a deliberate attempt to fill the boost input is refused in the page.
  const { results } = page.run(pageAgent, ['fill', { items: [...items, { role: 'evil', index: 3, label: 'Bid 101 Connects or higher to be ranked in 1st place.', value: '101', overwrite: true }] }]);
  assert.deepEqual(results.map(r => [r.role, r.ok, r.reason]), [['cover', true, undefined], ['rate', true, undefined], ['evil', false, 'refused: Connects / boost field']]);
  assert.equal(page.doc.querySelector('input[placeholder="Connects"]').value, '');
  assert.equal(page.doc.querySelector('[aria-label="Hourly rate"]').value, '30');
  assert.equal(page.clicks.length + page.submits.length, 0);
  // A screening question that says "rank" is still a question.
  assert.equal(classifyFields([{ index: 0, kind: 'textarea', label: 'Cover Letter' }, { index: 1, kind: 'textarea', label: 'How would you rank these features?' }]).questions.length, 1);
});

test('real fixed-price form (captured 2026-10-04): question found; single milestone gets amount + description; date and boost untouched', () => {
  const page = makePage(fx('apply-fixed-real-2026-10-04.html'), 'https://www.upwork.com/nx/proposals/job/~022106178515693258692/apply/');
  const read = page.run(pageAgent, ['read', null]);
  const form = classifyFields(read.fields);
  assert.equal(form.rate, null);
  assert.equal(form.cover.label, 'Cover Letter');
  assert.deepEqual(form.questions.map(q => q.text), ['Describe your recent experience with similar projects']);
  assert.equal(form.milestone.amount.label, 'Milestone 1 Amount');
  assert.equal(form.milestone.desc.label, 'Description 1');
  const draft = { coverLetter: 'Hi,\n\nC.', answers: ['Built three similar sites.'], rate: 1000, unit: 'fixed', milestone: 'Full 7-page site, built and launched' };
  const items = buildFillItems(form, draft, { fillRate: true, auto: true });
  assert.deepEqual(items.map(i => i.role), ['cover', 'q1', 'rate', 'milestone']);
  assert.equal(items.find(i => i.role === 'rate').overwrite, true);              // "$0.00" counts as empty
  page.run(pageAgent, ['fill', { items }]);
  const v = l => page.doc.querySelector(`[aria-label="${l}"]`).value;
  assert.equal(v('Milestone 1 Amount'), '1000');
  assert.equal(v('Description 1'), 'Full 7-page site, built and launched');
  assert.equal(v('Due date for the milestone'), '');
  assert.equal(page.doc.querySelector('input[placeholder="Connects"]').value, '');
  assert.equal(page.doc.getElementById('q1').value, 'Built three similar sites.');
  assert.equal(page.clicks.length + page.submits.length, 0);
  // Two milestones, or an hourly draft: the amount is left alone.
  assert.equal(classifyFields([...read.fields, { index: 99, kind: 'input', label: 'Milestone 2 Amount' }]).milestone, null);
  assert.ok(!buildFillItems(form, { ...draft, unit: 'hourly' }, { fillRate: true }).some(i => i.role === 'rate'));
  // A milestone amount you typed is kept on auto-fill.
  const typed = classifyFields(read.fields.map(f => (f.label === 'Milestone 1 Amount' ? { ...f, value: '$800.00' } : f)));
  assert.equal(buildFillItems(typed, draft, { fillRate: true, auto: true }).find(i => i.role === 'rate').overwrite, false);
});

test('feed: one tile per job, read-only — "Load More Jobs" is never clicked', () => {
  const page = makePage(fx('feed-2026-10-04.html'), 'https://www.upwork.com/nx/find-work/most-recent');
  const { tiles } = page.run(pageAgent, ['feed', null]);
  assert.deepEqual(tiles.map(t => t.id), ['~022106000000000000001', '~022106000000000000002', '~022106000000000000003']);
  assert.equal(tiles[0].title, 'Homepage redesign on an existing WooCommerce site');
  assert.equal(tiles[0].href, 'https://www.upwork.com/jobs/Homepage-redesign_~022106000000000000001/?referrer_url_path=/nx/find-work/');
  assert.match(tiles[0].description, /front-end redesign/);
  assert.ok(!tiles[0].text.includes('Data entry'));                                // the tile holds one job only
  assert.ok(!tiles[2].text.includes('Connects: 46'));
  assert.equal(page.clicks.length, 0);
});
