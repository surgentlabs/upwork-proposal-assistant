// Smoke test of the whole stack: the real popup (in a jsdom popup document) → the real worker →
// the real pageAgent on a jsdom proposal page, with a Gemini double.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installChrome, installFetch, makePage, geminiReply } from './_chrome.js';

const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const ID = '~021234567890123456789';
const APPLY_URL = `https://www.upwork.com/ab/proposals/job/${ID}/apply/`;

test('popup opens on a proposal page: drafts, fills, shows the result; settings save', async () => {
  const env = installChrome();
  Object.assign(env.store, { geminiApiKey: 'k', profileSkills: 'WooCommerce, PHP', hourlyRate: 45 });
  installFetch(async () => geminiReply({ cover_letter: 'Hi,\n\nZone first.\n\nPlan.\n\n$45/hr.\n\nNext step?', answers: ['Yes [link to a similar fix]', 'Tomorrow'], duration: '1 to 3 months', assessment: { fit: 0.9, clarity: 0.9, risk: 0.1, flags: [] } }));
  const page = makePage(fx('apply-page.html'), APPLY_URL);
  env.setPage(page);
  await import('../background.js');

  const html = readFileSync(new URL('../popup.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
  const pop = new JSDOM(html, { url: 'chrome-extension://test/popup.html', pretendToBeVisual: true });
  const errors = [];
  pop.window.addEventListener('error', e => errors.push(e.message));
  for (const [k, v] of Object.entries({ window: pop.window, document: pop.window.document, navigator: pop.window.navigator, confirm: () => true }))
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  // The popup's messages go to the worker's listener, like chrome.runtime.sendMessage does.
  const toWorker = env.chrome.runtime.sendMessage;
  env.chrome.runtime.sendMessage = m => (['LOG'].includes(m.type) ? toWorker(m) : env.message(m));
  env.chrome.tabs.query = async () => [{ id: 7, url: APPLY_URL }];

  await import('../popup.js');
  const $ = s => pop.window.document.querySelector(s);
  for (let i = 0; i < 50 && !$('#assist .banner.good'); i++) await new Promise(r => setTimeout(r, 20));

  assert.match($('#assist .banner.good').textContent, /Filled the cover letter, 1 of 2 answers, the rate\. Review it, set the duration to 1 to 3 months, and click Submit yourself\./);
  assert.match($('#assist .banner.warn')?.textContent || '', /Fill in before sending: \[link to a similar fix\]/);
  assert.equal($('#d-rate').value, '45');
  assert.match($('#d-cover').value, /^Hi,\n\nZone first/);
  assert.equal(pop.window.document.querySelectorAll('.d-ans').length, 2);
  assert.equal($('#status').value, 'filled');
  assert.ok($('#fill') && !$('#fill').disabled);
  assert.equal(page.doc.getElementById('cover').value.startsWith('Hi,'), true);
  assert.equal(page.clicks.length + page.submits.length, 0);

  // Settings: change the rate and a filter, save, and the stored config follows.
  $('nav [data-tab="settings"]').click();
  assert.equal($('#tab-settings').hidden, false);
  $('[name="hourlyRate"]').value = '50';
  $('[name="f_maxProposals"]').value = '5 to 10';
  $('[name="f_countriesExclude"]').value = 'IN, Pakistan';
  // A Gemini key pasted into the OpenRouter field is refused next to the field, and nothing is saved.
  $('[name="openrouterApiKey"]').value = 'AIzaSyWrongField';
  $('#settings').dispatchEvent(new pop.window.Event('submit', { cancelable: true }));
  await new Promise(r => setTimeout(r, 50));
  assert.equal($('#key-error').hidden, false);
  assert.match($('#key-error').textContent, /isn't an OpenRouter key — it looks like a Google Gemini key/);
  assert.ok($('[name="openrouterApiKey"]').classList.contains('invalid'));
  assert.notEqual(env.store.hourlyRate, 50);
  $('[name="openrouterApiKey"]').value = '';
  assert.equal($('[name="geminiApiKey"]').type, 'text');                  // not a password field → no password-manager autofill
  $('#settings').dispatchEvent(new pop.window.Event('submit', { cancelable: true }));
  for (let i = 0; i < 50 && env.store.hourlyRate !== 50; i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(env.store.hourlyRate, 50);
  assert.equal(env.store.filters.maxProposals, '5 to 10');
  assert.deepEqual(env.store.filters.countriesExclude, ['IN', 'Pakistan']);
  assert.equal(env.store.geminiApiKey, 'k');

  $('nav [data-tab="jobs"]').click();
  for (let i = 0; i < 50 && !$('#jobs .job-row'); i++) await new Promise(r => setTimeout(r, 20));
  assert.equal(pop.window.document.querySelectorAll('#jobs .job-row').length, 1);
  assert.match($('#stats').textContent, /1Ready/);
  assert.deepEqual(errors, []);
});
