import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJobText, jobIdFromUrl, pageKind, parsePostedMinutes, mergeJob, cutText } from '../shared/parse.js';
import { makePage } from './_chrome.js';
import { pageAgent } from '../page/agent.js';

const fx = f => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('job ids and page kinds from Upwork URLs', () => {
  assert.equal(jobIdFromUrl('https://www.upwork.com/freelance-jobs/apply/Senior-Next_~022106735680829161920/'), '~022106735680829161920');
  assert.equal(jobIdFromUrl('https://www.upwork.com/jobs/~014ddb86873c016b0f'), '~014ddb86873c016b0f');
  assert.equal(jobIdFromUrl('https://www.upwork.com/nx/find-work/best-matches/details/~01ABCDEF1234567890?x=1'), '~01abcdef1234567890');
  assert.equal(jobIdFromUrl('https://www.upwork.com/nx/find-work/'), null);
  assert.equal(pageKind('https://www.upwork.com/ab/proposals/job/~01abcdef1234567890/apply/'), 'apply');
  assert.equal(pageKind('https://www.upwork.com/nx/proposals/job/~01abcdef1234567890/apply/'), 'apply');
  assert.equal(pageKind('https://www.upwork.com/jobs/~01abcdef1234567890'), 'job');
  assert.equal(pageKind('https://www.upwork.com/nx/find-work/'), 'other');
  assert.equal(pageKind('https://www.upwork.com/x/~01abcdef1234567890', [{ label: 'Cover Letter' }]), 'apply');
});

test('posted-ago phrases', () => {
  assert.equal(parsePostedMinutes('Posted 9 hours ago'), 540);
  assert.equal(parsePostedMinutes('Posted 25 minutes ago'), 25);
  assert.equal(parsePostedMinutes('Posted an hour ago'), 60);
  assert.equal(parsePostedMinutes('Posted yesterday'), 1440);
  assert.equal(parsePostedMinutes('Posted 2 days ago'), 2880);
  assert.equal(parsePostedMinutes('Posted just now'), 0);
  assert.equal(parsePostedMinutes('nothing here'), null);
});

test('public job page (layout verified 2026-10-04): activity, type, client, skills — and nothing from "similar jobs" or the footer', () => {
  const job = parseJobText({ url: 'https://www.upwork.com/freelance-jobs/apply/Senior_~022106735680829161920/', title: 'Senior Next.js Developer for a Client Portal', mainText: fx('public-job.txt') });
  assert.equal(job.id, '~022106735680829161920');
  assert.equal(job.jobType, 'hourly');                       // the "Fixed-price" under Explore similar jobs is cut off
  assert.equal(job.experience, 'expert');
  assert.equal(job.projectLength, '1 to 3 months');
  assert.equal(job.hoursPerWeek, 'Less than 30 hrs/week');
  assert.equal(job.postedMinutesAgo, 540);
  assert.equal(job.proposals, '50+');
  assert.equal(job.proposalsMid, 60);
  assert.equal(job.interviewing, 14);
  assert.equal(job.invitesSent, 20);
  assert.equal(job.unansweredInvites, 5);
  assert.equal(job.lastViewed, '9 hours ago');
  assert.deepEqual(job.skills, ['Next.js', 'React', 'Vercel', 'Tailwind CSS']);
  assert.equal(job.client.memberSince, 'Jun 19, 2021');
  assert.equal(job.client.country, 'Spain');
  assert.equal(job.client.countryCode, 'ES');
  assert.equal(job.client.rating, null);                     // "Rating is 4.9 out of 5" is Upwork's footer, not the client
  assert.equal(job.client.paymentVerified, null);
  assert.match(job.description, /secure client portal/);     // fallback: text under "Summary"
  assert.ok(!/Business Development/.test(cutText(fx('public-job.txt'))));
});

test('logged-in job page (assumed layout): budget, connects, client card, screening questions', () => {
  const page = makePage(fx('job-page.html'), 'https://www.upwork.com/jobs/~021234567890123456789');
  const read = page.run(pageAgent, ['read', null]);
  assert.equal(read.blocked, null);
  assert.equal(read.title, 'Fix WooCommerce checkout losing shipping zone');
  assert.match(read.description, /Table Rate Shipping plugin/);
  const job = parseJobText(read);
  assert.equal(job.jobType, 'hourly');
  assert.equal(job.hourlyMin, 40);
  assert.equal(job.hourlyMax, 60);
  assert.equal(job.experience, 'intermediate');
  assert.equal(job.proposals, '5 to 10');
  assert.equal(job.interviewing, 0);
  assert.equal(job.connects, 12);
  assert.equal(job.connectsBalance, 84);
  assert.deepEqual(job.questions, ['Have you worked with WooCommerce Table Rate Shipping before?', 'How soon could you start?']);
  assert.deepEqual(job.skills, ['WooCommerce', 'PHP', 'WordPress']);
  const c = job.client;
  assert.equal(c.paymentVerified, true);
  assert.equal(c.rating, 4.9);
  assert.equal(c.reviews, 22);
  assert.equal(c.totalSpent, 48000);
  assert.equal(c.hires, 25);
  assert.equal(c.hireRate, 82);
  assert.equal(c.openJobs, 2);
  assert.equal(c.jobsPosted, 31);
  assert.equal(c.avgHourlyPaid, 38.1);
  assert.equal(c.country, 'Canada');
  assert.equal(c.memberSince, 'Mar 4, 2019');
});

test('fixed-price budget and unverified payment', () => {
  const job = parseJobText({ url: 'https://www.upwork.com/jobs/~01aaaaaaaaaaaaaaaa', mainText: 'Logo\nPosted 3 hours ago\n$250.00\nFixed-price\nEntry level\nExperience level\nAbout the client\nPayment method not verified\n$0 total spent\n0 hires\nUnited Kingdom\n' });
  assert.equal(job.jobType, 'fixed');
  assert.equal(job.budget, 250);
  assert.equal(job.experience, 'entry');
  assert.equal(job.client.paymentVerified, false);
  assert.equal(job.client.totalSpent, 0);
  assert.equal(job.client.hires, 0);
  assert.equal(job.client.countryCode, 'GB');
});

test('mergeJob keeps old values when the fresh read lacks them', () => {
  const m = mergeJob({ title: 'A', client: { totalSpent: 5, country: 'Spain' }, skills: ['x'] }, { title: '', client: { totalSpent: null, hires: 2 }, skills: [], connects: 8 });
  assert.deepEqual(m, { title: 'A', client: { totalSpent: 5, country: 'Spain', hires: 2 }, skills: ['x'], connects: 8 });
});
