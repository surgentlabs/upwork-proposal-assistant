import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreJob, scamSignals, filterMisses, isCountryExcluded, skillOverlap, currentAge } from '../shared/score.js';
import { FILTER_DEFAULTS } from '../shared/constants.js';

const good = { title: 'Fix WooCommerce checkout', description: 'Table Rate shipping bug in WooCommerce.', jobType: 'hourly', hourlyMin: 40, hourlyMax: 60, proposals: 'less than 5', interviewing: 0, postedMinutesAgo: 20, skills: ['WooCommerce', 'PHP'], client: { paymentVerified: true, totalSpent: 48000, hireRate: 82, hires: 25, rating: 4.9, reviews: 22, country: 'Canada', countryCode: 'CA' } };
const cfg = { profileSkills: 'WooCommerce, PHP, Elementor', hourlyRate: 45, filters: FILTER_DEFAULTS };

test('a strong job scores high with explained reasons; a weak one scores low', () => {
  const s = scoreJob(good, cfg);
  assert.ok(s.score >= 85, `score ${s.score}`);
  assert.ok(s.reasons.some(r => r.text === 'payment verified' && r.pts > 0));
  assert.ok(s.reasons.some(r => /matches WooCommerce, PHP/.test(r.text)));
  const weak = scoreJob({ ...good, proposals: '50+', interviewing: 12, postedMinutesAgo: 5000, skills: [], title: 'Logo', description: 'Need a logo', client: { paymentVerified: false, totalSpent: 0, hireRate: 0, hires: 0, jobsPosted: 4 } }, cfg);
  assert.ok(weak.score <= 10, `score ${weak.score}`);
  assert.ok(weak.reasons.some(r => r.text === 'none of your skills mentioned'));
});

test('scam signals: off-platform, ID/bank, pay-to-work, free work, crypto, email', () => {
  const sig = d => scamSignals({ title: '', description: d });
  assert.deepEqual(sig('Message me on Telegram for details'), ['asks to move the conversation off Upwork']);
  assert.deepEqual(sig('Send your bank details and a copy of your passport'), ['asks for bank or ID details']);
  assert.deepEqual(sig('You must pay for the training kit first'), ['asks you to pay for something']);
  assert.deepEqual(sig('Do a free test task first'), ['asks for free work']);
  assert.deepEqual(sig('We pay in crypto (USDT)'), ['wants to pay in crypto']);
  assert.deepEqual(sig('Email me at boss@example.com'), ['includes an email address to contact']);
  assert.deepEqual(sig('Build a WhatsApp Business API integration'), ['asks to move the conversation off Upwork']);   // known false positive, shown as a warning only
  assert.deepEqual(sig('Fix our checkout page'), []);
  const meh = { ...good, proposals: '20 to 50', interviewing: 6 };       // below the 100 clamp, so the penalty shows
  const s = scoreJob({ ...meh, description: 'Contact me on WhatsApp' }, cfg);
  assert.equal(s.scams.length, 1);
  assert.equal(scoreJob(meh, cfg).score - s.score, 25);
});

test('country exclude is exact code-or-name, never substring (AutoBidder v2.26.2 regression)', () => {
  const uk = { country: 'United Kingdom', countryCode: 'GB' };
  assert.equal(isCountryExcluded(uk, ['in', 'ng', 'it', 'us']), false);
  assert.equal(isCountryExcluded(uk, ['gb']), true);
  assert.equal(isCountryExcluded(uk, ['UK']), true);                       // alias of the same code
  assert.equal(isCountryExcluded({ country: 'Australia', countryCode: 'AU' }, ['us']), false);
  assert.equal(isCountryExcluded({ country: 'India', countryCode: 'IN' }, ['in']), true);
  assert.equal(isCountryExcluded({}, ['in']), false);
});

test('filters are reported as misses, never blocks', () => {
  const f = { ...FILTER_DEFAULTS, jobTypes: ['fixed'], maxProposals: '5 to 10', minHireRate: 90, requirePaymentVerified: true, maxConnects: 10, maxAgeMin: 10, keywordsExclude: ['shipping', 'ship'], countriesExclude: ['CA'] };
  const m = filterMisses({ ...good, proposals: '20 to 50', connects: 16, client: { ...good.client, paymentVerified: false } }, f);
  assert.deepEqual(m, ['hourly job', '20 to 50 proposals', 'hire rate 82%', 'payment not verified', '16 Connects', 'posted 20 min ago', 'client in Canada', 'mentions "shipping"']);
});

test('skill overlap uses tags and whole words; age keeps counting from postedAt', () => {
  assert.deepEqual(skillOverlap({ title: 'PHPUnit tests', description: '', skills: [] }, ['PHP']), []);
  assert.deepEqual(skillOverlap({ title: 'Fix a PHP bug', description: '', skills: [] }, ['PHP']), ['PHP']);
  const now = Date.now();
  assert.equal(currentAge({ postedAt: now - 90 * 60000 }, now), 90);
});
