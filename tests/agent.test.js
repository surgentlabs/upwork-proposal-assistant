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
