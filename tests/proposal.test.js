import test from 'node:test';
import assert from 'node:assert/strict';
import { decideRate, buildPrompt, parseDraftJson, ensureReadable, finishDraft, templateDraft, extractBriefQuestions, repairJson, qualityNotes } from '../bg/proposal.js';

const cfg = { profileSkills: 'WooCommerce, PHP, A, B, C, D, E, F, G, H, I, J, K, L', hourlyRate: 45, hourlyStrategy: 'profile', fixedBidRatio: 1, minFixedBid: 0 };

test('rate decisions are whole numbers and respect the strategy', () => {
  assert.deepEqual(decideRate({ jobType: 'hourly', hourlyMin: 20, hourlyMax: 35 }, cfg), { rate: 45, unit: 'hourly' });
  assert.deepEqual(decideRate({ jobType: 'hourly', hourlyMin: 20, hourlyMax: 35 }, { ...cfg, hourlyStrategy: 'within_range' }), { rate: 35, unit: 'hourly' });
  assert.deepEqual(decideRate({ jobType: 'hourly' }, { ...cfg, hourlyRate: 0 }), { rate: 0, unit: 'hourly' });
  assert.deepEqual(decideRate({ jobType: 'fixed', budget: 333 }, { ...cfg, fixedBidRatio: 0.9 }), { rate: 300, unit: 'fixed' });
  assert.deepEqual(decideRate({ jobType: 'fixed', budget: 50 }, { ...cfg, minFixedBid: 80 }), { rate: 80, unit: 'fixed' });
  assert.deepEqual(decideRate({ jobType: 'fixed' }, cfg), { rate: 0, unit: 'fixed' });
});

test('prompt carries the writing rules, the questions, and no more than 12 skills', () => {
  const job = { title: 'Fix checkout', description: 'Checkout drops the zone.\nPlease start your proposal with the word "zone".', skills: ['WooCommerce'], jobType: 'hourly', hourlyMin: 40, hourlyMax: 60 };
  const p = buildPrompt(job, cfg, { rate: 45, unit: 'hourly' }, ['How soon could you start?'], () => 0);
  for (const s of ['first person', '"Hi,"', 'BLANK LINE', 'two specific details', '2–4 step plan', 'NOT to get wrong', 'next step', 'no sign-off and no name', 'same language as the brief', '110 to 190 words',
    'Never invent', 'Whole-number', '"1 day"', 'leverage', 'seamless', 'robust', 'I am excited', 'As an expert', 'proposal list', 'Your rate: $45/hr', '1. How soon could you start?', 'Answer each one separately', '"answers"', 'Less than 1 month', '"risk"'])
    assert.ok(p.includes(s), `prompt missing: ${s}`);
  assert.match(p, /Your skills \(from your profile\): WooCommerce, PHP, A, B, C, D, E, F, G, H, I, J\n/);
  assert.match(p, /start your proposal with the word "zone"/);         // brief question surfaced
  assert.ok(!buildPrompt(job, cfg, { rate: 0, unit: 'fixed' }, []).includes('SCREENING'));
  assert.match(buildPrompt(job, cfg, { rate: 0, unit: 'fixed' }, []), /do not state a number/);
});

test('tolerant JSON: code fences, leading prose, raw newlines inside strings', () => {
  const raw = 'Sure! Here it is:\n```json\n{"cover_letter": "Hi,\n\nLine one.\n\nLine two.", "answers": ["Yes"], "duration": "1 to 3 months"}\n```';
  const j = parseDraftJson(raw);
  assert.equal(j.cover_letter, 'Hi,\n\nLine one.\n\nLine two.');
  assert.deepEqual(j.answers, ['Yes']);
  assert.equal(repairJson('{"a": "x\ny"}'), '{"a": "x\\ny"}');
  assert.equal(parseDraftJson('{"cover_letter": "broken'), null);
  assert.equal(parseDraftJson('{"x": 1')?.cover_letter, undefined);
  assert.match(parseDraftJson('Hi, this is plain prose that is long enough to count as a real cover letter written by a model.').cover_letter, /plain prose/);
});

test('layout safety net: one block becomes greeting + paragraphs; well-formed text is untouched', () => {
  const block = 'I read your brief about the checkout. The zone resets on postcode edits. I would trace update_order_review. Then patch the rates filter. I charge $45/hr. It takes 4 hours. Shall we start?';
  const out = ensureReadable(block);
  assert.match(out, /^Hi,\n\n/);
  assert.ok(out.split('\n\n').length >= 3);
  const good = 'Hi,\n\nPara one.\n\nPara two.';
  assert.equal(ensureReadable(good), good);
  assert.equal(ensureReadable('Hi, I read it. One. Two.'), 'Hi,\n\nI read it. One. Two.');
  assert.equal(ensureReadable('Hi Sam, I read it.\nOne.'), 'Hi Sam,\n\nI read it.\nOne.');
  assert.equal(ensureReadable('Hi,\nI read it.'), 'Hi,\n\nI read it.');
});

test('finishDraft: answers aligned to questions, no exclamation marks, duration validated, notes', () => {
  const logs = [];
  const d = finishDraft({ cover_letter: 'Hi,\n\nGreat project! I would leverage [link to past work].', answers: ['Yes!'], duration: 'less than 1 month', assessment: { fit: 80, clarity: 0.5, risk: '0.1', flags: [] } },
    ['Q1', 'Q2'], { rate: 45, unit: 'hourly' }, (m, l) => logs.push([m, l]));
  assert.ok(!d.coverLetter.includes('!'));
  assert.deepEqual(d.answers, ['Yes.', '']);
  assert.equal(d.duration, 'Less than 1 month');
  assert.deepEqual(d.assessment, { fit: 0.8, clarity: 0.5, risk: 0.1, flags: [] });
  assert.deepEqual(d.placeholders, ['[link to past work]']);
  assert.deepEqual(d.banned, ['leverage']);
  assert.ok(logs.some(([m, l]) => /1 screening question/.test(m) && l === 'warn'));
  assert.equal(finishDraft({ answers: [] }, [], { rate: 0 }), null);
});

test('template fallback has the same shape and flags its placeholders', () => {
  const t = templateDraft({ title: 'Fix checkout', skills: ['PHP'] }, cfg, ['Q1'], { rate: 45, unit: 'hourly' });
  assert.match(t.coverLetter, /^Hi,\n\n/);
  assert.match(t.coverLetter, /\$45\/hr/);
  assert.deepEqual(t.answers, ['']);
  assert.equal(t.source, 'template');
  assert.ok(t.placeholders.length >= 2);
});

test('brief questions and quality notes', () => {
  assert.deepEqual(extractBriefQuestions('Intro.\nWhen applying, answer these:\n1. Your stack?\n2. Your timeline?\nThanks'), ['When applying, answer these:', 'Your stack?', 'Your timeline?']);
  assert.equal(qualityNotes('one two three').words, 3);
});

test('hourly rate falls back to the profile rate shown on the proposal page', () => {
  assert.deepEqual(decideRate({ jobType: 'hourly', profileRate: 30 }, { ...cfg, hourlyRate: 0 }), { rate: 30, unit: 'hourly' });
  assert.deepEqual(decideRate({ jobType: 'hourly', profileRate: 30 }, cfg), { rate: 45, unit: 'hourly' });   // Settings wins
});

test('attachments the AI cannot see are flagged in the prompt', () => {
  const p = buildPrompt({ title: 'T', description: 'D', attachments: 1, jobType: 'hourly' }, cfg, { rate: 45, unit: 'hourly' }, []);
  assert.match(p, /attached 1 file that you have NOT seen/);
  assert.ok(!buildPrompt({ title: 'T', description: 'D' }, cfg, { rate: 45, unit: 'hourly' }, []).includes('NOT seen'));
});

test('the AI is told it has not opened any link or site the client mentions', () => {
  const p = buildPrompt({ title: 'T', description: 'Review our website example.com' }, cfg, { rate: 45, unit: 'hourly' }, ['Review our website. What would you improve?']);
  assert.match(p, /You have NOT opened any website, link, document or file/);
});
