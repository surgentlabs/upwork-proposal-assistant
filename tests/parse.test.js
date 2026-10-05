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

test('real proposal page (captured 2026-10-04): title, brief, category, Connects, profile rate — not the boost summary', () => {
  const job = parseJobText({ url: 'https://www.upwork.com/nx/proposals/job/~022106883383762540293/apply/', title: 'Submit a proposal', mainText: fx('apply-real-2026-10-04.txt') });
  assert.equal(job.title, 'Malware cleanup on several websites');
  assert.equal(job.category, 'Web Design');
  assert.equal(job.postedOn, 'Oct 5, 2026');
  assert.equal(job.postedMinutesAgo, null);
  assert.equal(job.description, 'Several client websites on shared hosting show a fake verification page.\nThe host\'s scanner flagged more sites. I need the fake page removed and all sites checked.');
  assert.ok(!/Bid to boost|Connects/.test(job.description));
  assert.equal(job.jobType, 'hourly');
  assert.equal(job.hourlyMin, 10);
  assert.equal(job.hourlyMax, 25);
  assert.equal(job.experience, 'intermediate');
  assert.equal(job.projectLength, 'Less than 1 month');
  assert.equal(job.hoursPerWeek, 'Less than 30 hrs/week');
  assert.equal(job.connects, 14);
  assert.equal(job.connectsBalance, 46);              // "you'll have 32 remaining" is after paying 14
  assert.equal(job.profileRate, 30);
});

test('real feed wording (captured 2026-10-04): "Fewer than 5", "$1K+ spent", rating 0 = unrated, "Connects: 46"', () => {
  const job = parseJobText({ url: 'https://www.upwork.com/nx/find-work/most-recent', mainText: fx('feed-tile-2026-10-04.txt') });
  assert.equal(job.proposals, 'less than 5');
  assert.equal(job.proposalsMid, 2);
  assert.equal(job.postedMinutesAgo, 4);
  assert.equal(job.projectLength, 'Less than 1 week');
  assert.equal(job.connectsBalance, 46);
  assert.equal(job.client.paymentVerified, true);
  assert.equal(job.client.totalSpent, 1000);
  assert.equal(job.client.rating, null);
  assert.equal(job.client.countryCode, 'US');
});

test('real fixed-price proposal page (captured 2026-10-04): truncated brief, qualifications banner, featured', () => {
  const job = parseJobText({ url: 'https://www.upwork.com/nx/proposals/job/~022106178515693258692/apply/', title: 'Submit a proposal', mainText: fx('apply-fixed-real-2026-10-04.txt') });
  assert.equal(job.title, 'Build a Simple 7-Page Wordpress/Elementor Site');
  assert.equal(job.jobType, 'fixed');
  assert.equal(job.budget, 1000);
  assert.equal(job.projectLength, '1 to 3 months');
  assert.equal(job.connects, 10);
  assert.equal(job.connectsBalance, 46);
  assert.equal(job.descriptionTruncated, true);
  assert.match(job.description, /lets visitors get in touch \(link r…$/);
  assert.deepEqual(job.qualificationMisses, ['Location: Americas, Asia']);
  assert.equal(job.featured, true);
  assert.deepEqual(parseJobText({ url: 'https://www.upwork.com/jobs/~01aaaaaaaaaaaaaaaa', mainText: 'x' }).qualificationMisses, []);
});

test('feed: tiles parsed from the verified tile layout; text-split fallback; feed URLs', async () => {
  const { isFeedUrl, parseFeedTile, splitFeedText } = await import('../shared/parse.js');
  assert.equal(isFeedUrl('https://www.upwork.com/nx/find-work/most-recent'), true);
  assert.equal(isFeedUrl('https://www.upwork.com/nx/find-work/'), true);
  assert.equal(isFeedUrl('https://www.upwork.com/nx/search/jobs/?q=wordpress'), true);
  assert.equal(isFeedUrl('https://www.upwork.com/nx/find-work/most-recent/details/~01abcdef1234567890'), false);
  assert.equal(isFeedUrl('https://www.upwork.com/jobs/~01abcdef1234567890'), false);
  const tiles = splitFeedText(fx('feed-tile-2026-10-04.txt'));
  assert.equal(tiles.length, 1);
  const t = parseFeedTile(tiles[0]);
  assert.equal(t.title, 'Homepage redesign on an existing site');
  assert.equal(t.jobType, 'hourly');
  assert.equal(t.experience, 'intermediate');
  assert.equal(t.projectLength, 'Less than 1 week');
  assert.equal(t.proposals, 'less than 5');
  assert.match(t.description, /front-end redesign/);
  assert.deepEqual(t.skills, ['Web Design', 'Landing Page Design']);
  const f = parseFeedTile({ title: 'X', text: 'Posted 2 hours ago\n•\nProposals: 50+\nX\nFixed-price - Entry level - Est. Budget: $30\nCopy products.\nSkills\nData Entry\nPayment unverified\nRating is 0 out of 5.\n$0 spent\nIndia' });
  assert.equal(f.jobType, 'fixed');
  assert.equal(f.budget, 30);
  assert.equal(f.experience, 'entry');
  assert.equal(f.client.paymentVerified, false);
  assert.equal(f.client.totalSpent, 0);
  assert.equal(f.client.countryCode, 'IN');
});

test('real job page before Apply (captured 2026-10-05): everything the scorer and prompt need', async () => {
  const { extractBriefQuestions } = await import('../bg/proposal.js');
  const text = fx('job-real-2026-10-05.txt');
  const descEl = text.slice(text.indexOf('Summary'), text.indexOf('\n$200.00'));   // what [data-test="Description"] holds
  const job = parseJobText({ url: 'https://www.upwork.com/jobs/~022106899113107183365?referrer_url_path=%2Fbest-matches%2Fdetails%2F~022106899113107183365', title: 'GeoDirectory + Elementor Pro expert to fix an events website', mainText: text, description: descEl });
  assert.equal(job.id, '~022106899113107183365');
  assert.equal(job.postedMinutesAgo, 4);
  assert.equal(job.jobType, 'fixed');
  assert.equal(job.budget, 200);
  assert.equal(job.experience, 'expert');
  assert.equal(job.proposals, 'less than 5');
  assert.equal(job.interviewing, 0);
  assert.equal(job.invitesSent, 0);
  assert.equal(job.connects, 14);
  assert.equal(job.connectsBalance, 46);
  assert.deepEqual(job.skills, ['Elementor', 'Custom Web Design', 'Geodirectory', 'WordPress']);
  assert.match(job.description, /^I'm building an events site/);                      // "Summary" heading stripped
  assert.ok(!/To freelancer|past job/.test(job.description));
  const c = job.client;
  assert.deepEqual([c.paymentVerified, c.phoneVerified, c.rating, c.reviews, c.totalSpent, c.hires, c.hireRate, c.openJobs, c.jobsPosted, c.country, c.memberSince],
    [true, true, 5, 6, 5900, 10, 67, 1, 6, 'United States', 'Jun 11, 2024']);
  assert.deepEqual(extractBriefQuestions(job.description), ['Please include examples of GeoDirectory websites you have worked on and briefly explain your experience integrating GeoDirectory with Elementor.']);
  // Client history (other freelancers' reviews, 3.0 ratings) never leaks into the client card.
  assert.equal(parseJobText({ url: '', mainText: text.replace('Rating is 5.0 out of 5.\n5.0\n5.00 of 6 reviews\n', '') }).client.rating, null);
});

test('real hourly job page (captured 2026-10-05): split range, level blurb, AUS, attachments, client extras', () => {
  const text = fx('job-hourly-real-2026-10-05.txt');
  const job = parseJobText({ url: 'https://www.upwork.com/jobs/Virus-removal-website_~022106883383762540293/?referrer_url_path=find_work_home', title: 'Malware cleanup on several websites', mainText: text, description: text.slice(text.indexOf('Summary'), text.indexOf('\nLess than 30 hrs/week')) });
  assert.deepEqual([job.jobType, job.hourlyMin, job.hourlyMax, job.experience, job.projectLength, job.hoursPerWeek], ['hourly', 10, 25, 'intermediate', 'Less than 1 month', 'Less than 30 hrs/week']);
  assert.deepEqual([job.proposals, job.lastViewed, job.interviewing, job.connects, job.connectsBalance, job.attachments], ['20 to 50', '13 minutes ago', 1, 14, 46, 1]);
  assert.match(job.description, /^Several client websites/);
  const c = job.client;
  assert.deepEqual([c.country, c.countryCode, c.hireRate, c.hires, c.totalSpent, c.avgHourlyPaid, c.totalHours, c.companySize, c.reviews, c.memberSince],
    ['AUS', 'AU', 100, 11, 6600, 10.11, 470, 'Small company (2-9 people)', 7, 'May 2, 2025']);
});

test('alpha-3 countries are uppercase-exact; words that look like codes are not countries', async () => {
  const { countryFromLines } = await import('../shared/parse.js');
  const { isCountryExcluded } = await import('../shared/score.js');
  assert.deepEqual(countryFromLines(['AUS']), { code: 'AU', name: 'AUS' });
  assert.deepEqual(countryFromLines(['USA']), { code: 'US', name: 'USA' });
  assert.deepEqual(countryFromLines(['GBR']), { code: 'GB', name: 'GBR' });
  assert.equal(countryFromLines(['Can', 'And', 'per']), null);
  assert.deepEqual(countryFromLines(['australia']), { code: 'AU', name: 'australia' });
  assert.equal(isCountryExcluded({ country: 'AUS', countryCode: 'AU' }, ['Australia']), true);
  assert.equal(isCountryExcluded({ country: 'Australia', countryCode: 'AU' }, ['aus']), true);
  assert.equal(isCountryExcluded({ country: 'Austria', countryCode: 'AT' }, ['aus']), false);
});
