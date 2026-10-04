# Upwork Proposal Assistant

A Chrome (Manifest V3) extension that helps you write Upwork proposals for the job **you have
open**. Click its icon on the job feed to rank every visible job, best first. Click it on a job and it scores the job and the client. Click **Draft proposal** and
your own AI key writes the cover letter, the screening-question answers, the rate and the
duration. On the proposal page it can **fill the form for you**. You review it and click
**Submit** yourself.

**Version:** 0.2.0

> **What it deliberately does not do.** It doesn't watch the job feed, run searches, refresh
> pages, work in the background or submit anything. Upwork's
> [automation policy](https://support.upwork.com/hc/en-us/articles/43342677368467-Use-bots-and-other-automation-properly)
> names job watchers, page monitors and background requests as things that get accounts
> restricted. The extension has **no permission to reach Upwork on its own**. Chrome only lets it
> see a tab right after you click its icon there (`activeTab`). See `NOTES.md` for the reasoning.

## Features

### On the job feed
- **Every visible job scored, best first.** Click the icon on *Most recent*, *Best matches* or a
  search results page. It reads the job tiles **already on the page** once (no "Load more", no
  refresh, no extra requests) and ranks them with the same scoring as a job page. Each row shows:
  - the pay;
  - how long ago the job was posted;
  - the proposals bucket;
  - the client (verified, amount spent, rating, country);
  - any scam signals or filter misses;
  - its status, if you've already worked on it.
- **Hide misses** filters out jobs outside your filters or with scam signals.

### On a job page
- **Score (0–100) with every point explained.** It weighs payment verification, client spend,
  hire rate, rating, proposals bucket, interviewing count, invites, how long ago the job was
  posted, how well it matches your skills, and the Connects cost.
- **Scam signals.** It flags requests to move to Telegram or WhatsApp, to send bank or ID
  details, to pay for training or equipment, to do free test work, or to be paid in crypto, and
  posts that include an email address.
- **Your filters as warnings.** Covers job type, level, budget or hourly floor, max proposals,
  client spend, hire rate, payment verified, has hired before, rating, max Connects, max age,
  excluded countries (exact code or name, never substring) and excluded keywords. Nothing is
  blocked; you opened the job yourself.
- **Draft proposal.** One AI call returns:
  - the cover letter, following the house rules (see below);
  - an answer to each screening question listed on the job;
  - a project duration;
  - an AI read of the job's fit, clarity and risk.

### On the proposal page (after *Apply now*)
- **Auto-fill** (on by default, Settings → Proposal form). Clicking the icon drafts if needed,
  then fills:
  - the cover letter and each screening answer, matched to its question by text;
  - the rate or bid, once per job.

  It never replaces text you've typed and never clicks anything. The duration dropdown is shown
  for you to set.
- **Fill form** button, with **Replace text already in the form** for a deliberate overwrite.
- **Fixed-price milestones.** On Upwork's default *By milestone* form with a single milestone,
  it fills Milestone 1's amount with your bid and its description with a one-line deliverable.
  You pick the due date.
- **Preferred-qualifications warning.** If Upwork says you don't meet the client's preferred
  qualifications (e.g. "Location: Americas, Asia"), it's shown and scored (−10), because the
  client sees it.
- **Keeps the full brief.** The proposal page shows only the start of the brief, so the full
  brief read on the job page is kept for drafting.
- **Edit in the popup.** The cover letter, answers and rate are editable there, with **Copy**
  buttons. Edits are saved with the job.
- **Before-you-send notes.** It lists [bracketed placeholders] the AI left for things only you
  know, such as a link to similar work, and any banned phrases that slipped through.

### Proposal writing rules
- Written in the first person, as a specialist in exactly what the job needs, from the brief.
- **Layout:**
  - "Hi," on its own line;
  - then 3–4 short paragraphs: what you understood (two details mirrored from the brief), a
    concrete plan with the right tools and one thing not to get wrong, price and timeline tied
    to scope, then one low-friction next step.
- If the AI returns one block anyway, the code splits it into paragraphs and adds the greeting.
- **Voice:** human, no buzzwords, no exclamation marks, no sign-off, in the same language as the
  brief, 110–190 words.
- **Honesty guard:** no invented clients, links, certifications, years of experience or
  statistics.
- If the AI is unavailable or no key is set, it falls back to a template with clearly marked
  gaps.

### Jobs and log
- **Jobs tab.** Every job you've opened, newest first, with its score and status:
  - Read, Drafted, Filled
  - Submitted, Viewed, Interview, Offer, Hired, Declined, No reply, Skipped

  Counters show Ready, Submitted, Replies and Hired. You set statuses as replies arrive; those
  labels train the on-device model planned for a later version. Export as JSON.
- **Activity log** with level filter, copy, clear and day dividers.
- **Diagnostics → Copy page snapshot.** Copies the page's visible text and field labels (never
  what you've typed) so selector problems can be fixed from a real page.

### Safety
- **Stops on a challenge or login page.** If Upwork shows "verify you are human", a CAPTCHA or a
  login wall, nothing is read or filled. It tells you and waits for you.
- **Never spends Connects.** The proposal page's "Boost your proposal" bid (in Connects) is never filled. The page code refuses any input that mentions Connects, boost or rank.
- **Never submits.** Tests assert that the page code never calls `click()` or `submit()`, and
  that the manifest has no Upwork host permission, alarms or content scripts.

## Getting started

1. Unzip the release and open `chrome://extensions`. Turn on **Developer mode**, click **Load
   unpacked** and pick the folder.
2. In the popup, open **Settings**:
   - add a Gemini or OpenRouter key and click **Test connection**;
   - enter your skills and hourly rate;
   - optionally set fixed-price bidding and filters;
   - click **Save**.
3. Open an Upwork job and click the icon. It scores the job; click **Draft proposal**.
4. Click **Apply now** on Upwork, then click the icon again. The form is filled. Review it, set
   the duration, fill any [placeholders], and click **Submit**.
5. As replies come in, set each job's status in the **Jobs** tab.

If something on a page isn't picked up, open **Settings → Diagnostics → Copy page snapshot** on
that page and send it over.

## Privacy

Everything is kept in the extension's local storage in your browser: settings, jobs, drafts,
statuses and the log. Data leaves the browser in exactly these cases:

- **Your AI provider** (Google Gemini or OpenRouter, using your own key). When you draft, it
  receives:
  - the job's title, brief, skills, budget or rate range, length and level;
  - the screening questions;
  - your skill list (first 12) and your rate.

  Nothing else is sent: no client names, no Upwork account data.
- **Upwork**: nothing. The extension makes no requests to Upwork. It only reads, and fills
  fields on, the page you clicked the icon on.

API keys are checked for the right format before they're saved or used, and they can be kept for the browser session only, and they're never included in settings
exports. The popup uses system fonts, so no third-party requests are made when it opens.

## Development

```bash
npm install
```

```bash
npm test
```

```bash
npm run zip
```

`npm test` runs the syntax check and the `node --test` suite. The suite covers the parser, the
in-page agent on jsdom pages, form roles and fill rules, scoring and filters, proposal
parsing/layout, end-to-end worker flows, and a popup → worker → page smoke test. To preview the
popup in a normal browser, open `popup.html` over a local web server; `preview-shim.js` supplies
demo data.

## Recent releases

| Version | Date | Highlights |
|---|---|---|
| 0.2.0 | 2026-10-05 | **Feed scoring:** click the icon on the job feed to rank every visible job, best first, in one read (nothing loaded or refreshed). Fixed-price jobs: the single milestone's amount and description are filled. The "you don't meet the client's preferred qualifications" banner is shown and scored. The proposal page's cut-off brief no longer replaces the full one. |
| 0.1.3 | 2026-10-05 | Real Upwork wording from a feed capture: "Proposals: Fewer than 5" now counts as the least-competition bucket; a client with "Rating is 0 out of 5" (no reviews yet) is no longer penalised as badly rated; "$1K+ spent" is read; "Less than 1 week" and "Connects: 46" are recognised. |
| 0.1.2 | 2026-10-05 | Tuned to a real proposal-page capture: correct job title, brief and category when you go straight to *Apply*; correct Connects balance; your profile rate is used when Settings has none; **the "Boost your proposal" Connects bid can never be filled** (refused in the page too). |
| 0.1.1 | 2026-10-05 | Fix "OpenRouter: Missing Authentication header": API keys are checked when you save or test (a Gemini key in the OpenRouter field, or a pasted "Bearer " prefix, is caught next to the field), a wrong-kind key is never sent, rejected keys get a plain explanation, and the key fields can no longer be autofilled by Chrome's password manager. |
| 0.1.0 | 2026-10-04 | First version. Assisted on-click workflow (no feed watching); job and client scoring with reasons; scam signals; filters as warnings; AI cover letter, screening answers, rate and duration; optional auto-fill of the proposal form (never submits); Jobs tab with outcome statuses; activity log; page snapshot for diagnostics. |
