# Upwork Proposal Assistant — Design Notes (newest first)

## v0.2.2 — Real hourly job page
Captured 2026-10-05 with v0.2.0. Saved as `tests/fixtures/job-hourly-real-2026-10-05.txt` with a
neutral brief and the client's history anonymised. The capture's missing level and leading
"Summary" were already fixed in v0.2.1; this fixture confirms both ("Intermediate" / "I am
looking for a mix of experience and value").

**Verified:**
- the hourly range split over lines (`$10.00` / `-` / `$25.00` / `Hourly`), parsed by the
  existing `\s*` patterns;
- `Less than 30 hrs/week` / `Hourly` / `Less than 1 month` / `Duration`;
- "Attachment" followed by "<file> (134 KB)";
- "Upgrade your membership to see the bid range";
- client: "AUS", "Clayton11:16 AM", "$10.11 /hr avg hourly rate paid", "470 hours", "Tech & IT",
  "Small company (2-9 people)".

**Fixes:**
- **Country codes:** Upwork shows the client country as a name ("United States"), an alpha-3
  code ("AUS" here, "USA" on the feed) or both, depending on the page. `shared/countries.js` now
  carries alpha-3 codes and official names, generated from pycountry and covering all 249 rows.
  - `countryFromLines` matches names case-insensitively but alpha-3 **only as an exact uppercase
    line**, so "Can", "And" or "Per" on their own aren't countries.
  - Country excludes accept alpha-3 too ("AUS" excludes Australia, not Austria).
- **Attachments:** `job.attachments` counts "(… KB/MB)" lines. The prompt tells the AI it has NOT
  seen them and may at most say it will review them.
- **`client.totalHours` and `client.companySize`:** recorded for the model, not scored.

**Tests:** 55.

## v0.2.1 — Real logged-in job page (before Apply)
Captured 2026-10-05 at `/jobs/~…?referrer_url_path=/best-matches/details/~…` (the job's own
page). Saved as `tests/fixtures/job-real-2026-10-05.txt` with a neutral brief and the client's
history anonymised.

**Now verified** (the v0.1.0 "assumed" list, apart from what's noted below):
- the title in `<h1>`; `[data-test="Description"]` present, starting with its own "Summary"
  heading;
- "Posted 4 minutes ago";
- `$200.00` / `Fixed-price`;
- the level line followed by its blurb ("Expert" / "I am willing to pay higher rates for the
  most experienced freelancers");
- "Skills and Expertise" with one skill per line;
- "Preferred qualifications" (empty here);
- "Activity on this job": `Proposals:` `Less than 5`, `Interviewing:`, `Invites sent:`,
  `Unanswered invites:`;
- "Send a proposal for: 14 Connects", "Available Connects: 46";
- "About the client":
  - "Payment method verified", "Phone number verified";
  - "Rating is 5.0 out of 5." and "5.00 of 6 reviews";
  - the country, then city + local time ("Las Vegas5:12 PM", no space);
  - "6 jobs posted", "67% hire rate, 1 open job", "$5.9K total spent", "10 hires, 3 active";
  - "Member since Jun 11, 2024";
- "Client's recent history (9)", with other freelancers' names, reviews and ratings. It's cut by
  the existing marker; a test checks a 3.0 history rating can't become the client's rating.

**Fixes:**
- **Experience:** recognised from the level line plus its "I am looking for / willing to pay…"
  blurb. Before, it was `null` on job pages.
- **Brief:** the leading "Summary" heading is stripped from the description.
- **`client.phoneVerified`:** recorded, not yet scored; it's a feature for the model.

**Still unverified:**
- **Hourly jobs on the job page:** the range line (assumed `$40.00 - $60.00` / `Hourly`).
- **Clients who pay hourly:** "avg hourly rate paid".
- **Screening questions listed on the job page:** "You will be asked to answer…". This job had
  none, though the proposal page's question fields are verified.
- **Feed tiles' DOM:** the link and ancestor structure.
- **The job-details slide-over panel.**

## v0.2.0 — Feed scoring; fixed-price milestones; qualifications banner
**Feed scoring** (user asked for it after we explained the risk was the same as reading a job
page):

- `isFeedUrl` covers `/nx/find-work/…`, `/nx/search/jobs…` and `/nx/jobs/search…` without a job
  id. On those, `readTab` hands off to `scoreFeed`.
- **`pageAgent('feed')`:**
  - takes every `<a>` whose href has a `~0…` id and `/jobs/`, `/details/` or `/apply/`;
  - each tile is the **largest ancestor that contains links to that one job only**, so no class
    names are relied on;
  - returns `{ id, href, title, text, description }`, with the description from a
    `data-test*="JobDescription"` / `"Description"` element when present;
  - caps at 60 tiles, reads only, and never touches "Load More Jobs".
- **Fallback:** if no job links are found, `splitFeedText` splits the visible text at each
  "Posted … ago" (the verified tile start), with the title on the line after "Proposals:".
- **`parseFeedTile`** reuses `parseJobText` plus the verified type line ("Hourly - Intermediate
  - Est. Time: …" / "Fixed-price - Entry level - Est. Budget: $30") for type, level, budget and
  length. "Hourly: $25.00 - $50.00 - …" is assumed. Skills come from between "Skills" and "Next
  skills".
- **Scoring:** `scoreJob` as usual, sorted best first, with each tile's stored status if you've
  already opened it. One log line. **Nothing is stored and no AI call is made.**
- **Popup:** a ranked list with "Hide misses" (filter misses or scam signals), remembered in
  `localStorage`.
- **Unverified:** the tile DOM (the text layout is verified, the link and ancestor structure is
  not). A feed snapshot now includes `feed: [first 5 tiles + parsed]` to check it.

**Fixed-price proposal page** (real capture 2026-10-04, saved as
`tests/fixtures/apply-fixed-real-2026-10-04.{txt,html}` with neutral text):

- **"By milestone" is the default.** Its fields are `Description 1`, `Due date for the milestone`
  (a date picker) and `Milestone 1 Amount` (shows "$0.00"). "Total price of project" is text,
  not an input.
- **The screening question has the label "Describe your recent experience with similar
  projects".** It was classified correctly.
- **Single-milestone filling:** with exactly one milestone row, `classifyFields` returns
  `milestone: { amount, desc }`, and `buildFillItems` fills:
  - the amount with the bid. "$0.00" counts as empty; an amount you typed is kept on auto-fill;
    it's automatic only once per job, like the rate;
  - the description with `draft.milestone`, a new prompt field (one line under 60 characters,
    fixed jobs only), or "Complete project as described". Empty only.

  The due date is never touched. With two or more milestone rows, nothing is filled.
- **The brief is cut short** ("… (link r… more"). `jobDetails` sets `descriptionTruncated`.
  `readTab` keeps the stored brief when the new one is truncated or shorter. When there's only
  the truncated one, the prompt says so and the popup suggests reading the job page first.
- **Banner:** "You do not meet all the client's preferred qualifications … does not meet the
  following criteria: Location: Americas, Asia" becomes `qualificationMisses`. It's a warning
  banner and −10 in the score. "Featured Job" becomes `featured`, recorded for the model.

**Tests:** 51. New: fixed-price parse; milestone fill, including date and boost untouched,
2-row, hourly and typed-amount cases; feed tile isolation, with "Load More Jobs" never clicked;
feed and tile parse plus the text fallback; end to end, the job-page brief survives the
proposal page, the milestone and question are filled and the qualification is scored; end to
end feed scoring with no AI call, nothing stored, and read + feed only.

## v0.1.3 — Wording from a logged-in feed capture
The user sent a snapshot of `/nx/find-work/most-recent`, the feed rather than a job page. That
is correctly `kind: other`, so nothing is scored there. Saved, with neutral text, as
`tests/fixtures/feed-tile-2026-10-04.txt`.

**Verified tile layout:**
- "Posted 4 minutes ago • Proposals: Fewer than 5";
- the title;
- "Hourly - Intermediate - Est. Time: Less than 1 week, Less than 30 hrs/week", or
  "Fixed-price - Entry level - Est. Budget: $30";
- the brief, then "Skills" with one skill per line;
- "Payment verified", "Rating is 0 out of 5.", "$1K+ spent" and the country ("USA");
- the sidebar's "Connects: 46".

**Fixes:**
- "Fewer than 5" maps to the `less than 5` bucket. Before, those jobs got no proposals score.
- "Rating is 0 out of 5" now means unrated (`null`). Before, it scored −6 as "client rated 0".
- "$1K+ spent" without "total" is read as spend.
- "Less than 1 week" is a project length.
- "Connects: 46" is used as a last-resort balance.

**Not built (proposed to the user):** scoring every visible tile on the feed when you click the
icon there. It would be one read of the page you opened, with no extra requests and no polling.

**Still needed:** a real single-job capture, either the job's own page (`/jobs/~…`) or the
details panel. The panel may render outside `<main>`; if so, the reader needs to look there.

## v0.1.2 — First real capture: logged-in proposal page (hourly job, no screening questions)
The user sent a v0.1.0 snapshot of `/nx/proposals/job/~…/apply/`. It's saved as
`tests/fixtures/apply-real-2026-10-04.{txt,html}`, with the client's brief replaced by neutral
text.

**Verified:**
- the `<h1>` is "Submit a proposal";
- the job sits under "Job details": the title line, then "<Category> Posted Oct 5, 2026", then
  the brief ending in "less" / "More/Less about" / "View job posting";
- value-then-label pairs: `Intermediate`/`Experience level`, `$10.00 - $25.00`/`Hourly range`,
  `Less than 30 hrs/week`/`Hourly`, `Less than a month`/`Project length`;
- "This proposal requires 14 Connects", and "When you submit this proposal, you'll have 32
  Connects remaining." (the balance after paying);
- "Your profile rate: $30.00/hr" and "Client's budget: …";
- fields:
  - `Hourly rate` (input, value "$30"), `You'll receive` (input), `Cover Letter` (textarea,
    "4019 characters left");
  - **"Bid 101 Connects or higher to be ranked in 1st place."** (input, placeholder "Connects"):
    the *Boost your proposal* auction;
- no duration control on this hourly job, and no description `data-test` hook;
- the boost section ends with a "Summary" block ("Bid to boost / Required for proposal / Total /
  Send for 14 Connects").

**Bugs it exposed, now fixed:**
1. The title was taken from the `<h1>` ("Submit a proposal"). `jobDetails()` now reads the line
   after "Job details", plus the category and brief.
2. The description fell back to the text under "Summary", which here was the boost summary. The
   fallback now refuses a "Summary" followed by "Bid to boost", and the proposal-page brief comes
   from `jobDetails()`.
3. The Connects balance read 32. It is now the remaining figure plus the cost, which is 46.
4. "Less than a month" wasn't recognised; it's normalised to "Less than 1 month". "Posted Oct 5,
   2026" is kept as `postedOn` and shown when there's no relative age.
5. With no rate in Settings, nothing was bid. `decideRate` now falls back to `job.profileRate`
   read off the page, and the score's "rate above their max" check uses it too.
6. **Boost bid safety.** v0.1.0 skipped the field only because its rate-exclusion list happened
   to include "connects". Now:
   - `classifyFields` drops any input matching `SPENDS_CONNECTS_RE` (`connects?|boost|rank(ed)|1st
     place`) before assigning roles;
   - `pageAgent('fill')` independently refuses any such input with "refused: Connects / boost
     field", even if asked;
   - it's inputs only, so a screening question that says "rank" still counts.

**Still unverified:**
- **screening-question fields:** this job had none, so the next capture should be from a job
  that has them;
- **the fixed-price "Bid" field and the milestone / "By project" choice;**
- **whether Upwork's currency-masked rate input accepts a value set programmatically:** check
  that "You'll receive" updates after a fill;
- **the logged-in job page:** client card, posted-ago, screening-question list.

**Tests:** 43. New: real-page parse; boost never classified, and refused even when targeted;
"rank" questions kept; the profile-rate fallback; and end to end, the real page straight away
with no Settings rate, checking the real title and brief reach the AI and the boost stays empty.

## v0.1.1 — "OpenRouter: Missing Authentication header"
Report: drafting or testing showed `OpenRouter: Missing Authentication header`.

**Diagnosis.** We probed OpenRouter directly on 2026-10-05. It returns that exact message for any
bearer token that isn't an OpenRouter key:

- an empty token, `Bearer Bearer …`, a Gemini `AIza…` key or an Anthropic `sk-ant-…` key all get
  "Missing Authentication header";
- a well-formed but wrong `sk-or-v1-…` key gets "User not found.";
- no header at all gets "No cookie auth credentials found".

So the extension did send the header, but the OpenRouter field held something that wasn't an
OpenRouter key. v0.1.0 never checked the key's shape. Plausible ways in:

1. a key pasted into the wrong field;
2. Chrome's password manager autofilling a saved password into the `type="password"` key
   inputs (Chrome ignores `autocomplete="off"` on password fields);
3. the Gemini → OpenRouter fallback, when Gemini is rate limited.

**Fix:**
- **`shared/keys.js`:**
  - `cleanKey` strips a pasted `Bearer ` / `Authorization:` prefix, quotes and whitespace;
  - `keyKind` recognises `sk-or-`, `AIza`, `sk-ant-` and `sk-`;
  - `checkKey(provider, key)` says what's wrong. OpenRouter must be `sk-or-…`. Gemini rejects
    only *recognisably other* providers' keys, because Google may add formats.
- **Popup:**
  - Save and Test connection validate the keys and show the problem next to the fields;
  - nothing is saved while a key is wrong;
  - an already-saved bad key is flagged when Settings opens;
  - the key inputs are now plain text inputs masked with `-webkit-text-security`, unmasked on
    focus, so the password manager ignores them.
- **Worker:**
  - `getConfig` cleans stored keys;
  - `resolveProvider` treats a wrong-kind key as missing, so it is never sent; it logs why and
    falls through to the other provider or the template;
  - 401 replies (and Gemini's 400/403 "API key" errors) become "OpenRouter rejected the key (…)
    — check Settings → OpenRouter API key; it should start with "sk-or-v1-"" with reason
    `auth`.
- **Tests:** 39, four new:
  - key normalisation and kinds;
  - the worker never sends a Gemini key to OpenRouter and uses Gemini instead;
  - a wrong-kind-only key gives the template with no request;
  - "Bearer " isn't doubled, and a 401 gets the plain message;
  - the popup refuses to save a wrong-kind key and the key inputs aren't password fields.

## v0.1.0 — Assisted, on-click workflow; scoring, drafting and optional form auto-fill

### Why this isn't the hand-off's "scanner → queue" design
The hand-off modelled v1 on Freelancer AutoBidder: poll the logged-in job feed every 2–3 minutes,
queue jobs, draft, then pre-fill the form. On 2026-10-04 we checked Upwork's Help Center article
"Use bots and other automation properly" (support.upwork.com/hc/en-us/articles/43342677368467).
It lists, as extension behaviours that can trigger warnings, restrictions or blocks:

- job alert or watcher tools that scrape or run searches;
- auto-refresh tools and page monitors that poll for updates;
- auto-paging helpers;
- "any tool that sends requests to Upwork when the tab is idle or in the background".

It also says extensions that read or change Upwork pages *could* trigger enforcement, and that no
exceptions are made for productivity tools.

The approved route is an Upwork API key. Criteria found on 2026-10-04 (unconfirmed for this
account):

- $25k+ lifetime earnings, a Job Success Score of at least 90%, and ID verification;
- personal or internal use only, at most 40k requests a day.

Even with a key, Upwork flags:

- using browser session cookies or tokens in a script;
- calling website pages instead of API endpoints;
- "background polling that resembles scraping".

The GraphQL API has job search (`marketplaceJobPostingsSearch`) but no way to submit a proposal.

The user chose **option (b)**: no automatic job finding; the extension acts only on the page you
open, when you click. They also asked for **an option to fill the fields automatically**.

### What that means in code
- **Manifest permissions:** `storage`, `activeTab`, `scripting`. **No Upwork host permission.**
  No alarms, `tabs`, cookies, webRequest, debugger, or content scripts. Host permissions cover
  only the two AI providers.
- **Page access only on your click.** Chrome grants `activeTab` when you click the toolbar icon
  on a tab, and drops it when that tab navigates. The worker injects `page/agent.js`
  (`pageAgent`, one self-contained function) with `chrome.scripting.executeScript`. It does two
  things:
  - `read` returns the title, the `data-test="Description"` text, the main text (≤ 40k chars)
    and the visible form fields with their labels;
  - `fill` sets values with the native value setter and dispatches `input` and `change`.

  It never clicks, submits, navigates or fetches. Tests grep for `.click()`, `.submit()`,
  `requestSubmit`, `setInterval` and `chrome.alarms` in the shipped files.
- **No network calls to Upwork at all.** The only `fetch` is in `bg/ai.js`, through
  `bg/http.js` `timedFetch`.
- **Flow** (`background.js`):
  - **Job page:** `ASSIST` → `readTab` (parse, merge, score, store). No AI call; drafting waits
    for **Draft proposal**, because it costs an AI call.
  - **Proposal page, auto-fill on:** `ASSIST` → `readTab`. Then `draftJob`, unless the stored
    draft already answers every form question; matching is by text, or by position when the
    counts are equal. Then `fillJob({ auto: true })`.
  - **Proposal page, auto-fill off:** read only. **Fill form** sends `FILL` (manual), with
    optional overwrite.
- **Auto-fill rules** (`shared/form.js buildFillItems`):
  - text fields are filled only when empty, so text you typed is never replaced (overwrite needs
    the manual button plus the checkbox);
  - the rate is set even when non-empty (Upwork pre-fills your profile rate), but automatically
    only once per job (`rateAutoFilled`), so a rate you changed is left alone when you reopen
    the popup;
  - the duration control is a custom dropdown, so it's shown, not set.
- **Challenge or auth wall** (ground rule 2). The agent checks:
  - the title (`just a moment`, `attention required`, `access denied`);
  - short-page text (`verify you are human`, `captcha`, `unusual activity`…);
  - CAPTCHA or challenge iframes;
  - login URLs or "Log in to Upwork".

  On a hit, nothing is parsed or filled; it logs a warning and tells you. Phrases are only
  trusted on pages under 2,500 characters, so a job *about* captchas doesn't trip it.
- **Re-entrancy:** one in-flight draft per job (`drafting` map). Store writes are serialised
  (`bg/store.js updateJob`), so a draft finishing while you change a status can't lose either
  change.

### Page reading: what's verified
Parsing keys off visible labels, not class names (`shared/parse.js`). The text is first cut at
"Explore similar jobs", "Other open jobs by this client", "Client's recent history", "How it
works" and "About Upwork". Without that cut, the similar-jobs list leaks "Fixed-price" and the
footer leaks "Rating is 4.9 out of 5".

**Verified** on a logged-out public job page (`/freelance-jobs/apply/<slug>_~02…/`), 2026-10-04.
The fixture `tests/fixtures/public-job.txt` mirrors this layout:

- the title in `<h1>` and the description in `[data-test="Description"]`;
- "Posted 9 hours ago";
- value-then-label lines: `Less than 30 hrs/week`, `Hourly`, `1-3 months` / `Duration`,
  `Expert` / `Experience Level`;
- "Skills and Expertise" followed by one skill per line;
- "Activity on this job" with `Proposals:` / `50+`, `Last viewed by client:`, `Interviewing:`,
  `Invites sent:` and `Unanswered invites:`;
- "About the client" with "Member since Jun 19, 2021", then the country.

**Unverified (assumed) until a logged-in snapshot confirms it.** The fixture
`tests/fixtures/job-page.html` uses these patterns:

- **Pay:** `$40.00 - $60.00` / `Hourly`; `$250.00` / `Fixed-price`.
- **Connects:** "Send a proposal for: 12 Connects", "Available Connects: 84".
- **Client card:** "Payment method verified"; "4.9 of 22 reviews"; "$48K total spent"; "25 hires,
  3 active"; "82% hire rate, 2 open jobs"; "31 jobs posted"; "$38.10 /hr avg hourly rate paid".
- **Screening questions:** listed under "You will be asked to answer the following questions…".
- **Job ids:** `~0…` in all URL shapes (`/jobs/~…`, `/freelance-jobs/apply/…_~…`,
  `/nx/find-work/…/details/~…`, `/ab|nx/proposals/job/~…/apply/`).

### Form roles (v0.1.0 — see v0.1.2 for what a real capture confirmed)
`classifyFields` is checked against `tests/fixtures/apply-page.html`, which is assumed, not
captured. The rules:

- **Cover letter:** the textarea or rich field whose label or placeholder says "Cover letter",
  else the first text box.
- **Questions:** the other text boxes, using their label (`<label for>`, `aria-labelledby`,
  `aria-label`, a wrapping label, or the nearest preceding text block). Trailing "0/5000
  characters" counters and "(optional)" are stripped.
- **Rate:** an input labelled "Hourly rate", "Bid", "Total price" or "amount you'd like…", and not
  "receive", "fee", "milestone" or "Connects".
- **Job type** when you go straight to the proposal page: inferred from the rate label (hourly
  vs bid). A test caught that no rate was set without this.

**Next step:** the user sends **Diagnostics → Copy page snapshot** from (1) a logged-in job page
and (2) a proposal page with screening questions. Then the fixtures get replaced with real
captures and the patterns fixed.

### Scoring (until the model exists)
`shared/score.js scoreJob` starts at 50, adds signed points (each shown as a chip), and clamps
to 0–100:

- payment verified ±;
- spend tiers;
- hire-rate tiers;
- never-hired penalty;
- rating;
- proposals bucket (+12 … −12);
- interviewing;
- invites;
- age;
- skill overlap (tags, or whole-word in the title or brief);
- your rate above the client's max;
- Connects over 16;
- **−25 per scam signal.**

Filters (`filterMisses`) are warnings only. Country exclusion is exact code-or-name using
`shared/countries.js` (ISO list from the system tz database plus aliases), never substring: the
AutoBidder v2.26.2 bug matched "in" inside "united kingdom". "WhatsApp Business API" jobs are a
known false positive of the off-platform rule; it's a warning, not a block.

### Drafting
`bg/proposal.js`:

- **Prompt:** carries the hand-off's §3 rules verbatim in spirit, including:
  - first person, as a specialist;
  - the mandatory layout and two mirrored details;
  - a plan with the one thing not to get wrong;
  - price and timeline tied to scope, then a next step;
  - the banned list, no sign-off, same language, 110–190 words;
  - the honesty guard and whole numbers.

  Questions the client asks *inside the brief* (`extractBriefQuestions`, from AutoBidder) are
  handled in the cover letter. Upwork's screening questions are answered separately in
  `answers[]`.
- **Placeholders:** where only the freelancer can supply something (a link, a past project), the
  AI writes a `[bracketed placeholder]` instead of inventing it. `qualityNotes` surfaces these
  and any banned phrases in the popup.
- **Parsing the reply:**
  - Gemini is called with `responseMimeType: application/json` and an 8192-token budget,
    because thinking models count reasoning against it;
  - `parseDraftJson` still tolerates fences, leading prose and raw newlines in strings
    (`repairJson`);
  - `ensureReadable` splits a one-block reply and adds "Hi,";
  - exclamation marks become full stops.
- **Fixed AutoBidder bug:** `ensureReadable` turned "Hi, I read it. One. Two." into "Hi, I read
  it.\n\nOne. Two." Only the greeting (plus an optional name) moves now.
- **Rate:**
  - hourly is your profile rate, optionally clamped into the client's range;
  - fixed is budget × ratio, with an optional floor;
  - both are whole numbers;
  - 0 (unknown) → the AI is told not to state a number, and the rate field is left alone.
- **Template fallback** on no key or any AI error, with `[bracketed]` gaps. Logged.
- **Default model ids:** `gemini-2.5-flash` and `google/gemini-2.5-flash`. These are editable and
  unconfirmed for October 2026; use **Test connection**.

### Not carried over from AutoBidder (on purpose)
- **Scanner, queue, prefetch, pacing, caps and dry run:** no background activity.
- **"Learn from the bids that beat you":** Upwork doesn't show winning bids.
- **API-first outcome detection:** reading "My proposals" automatically is exactly the
  background read Upwork flags. Outcomes are labels you set in the Jobs tab. Their status set
  (viewed / interview / offer / hired / declined / no_reply) is ready for the two models in the
  hand-off: hired vs not, and a faster "got a reply" model.

### Tests (35)
- **`parse`:** URL shapes, posted-ago, the verified public layout including the cut, the assumed
  logged-in layout through the real agent on jsdom, fixed and unverified clients, merge.
- **`agent`:** labels, hidden and file fields ignored, typed text never returned, fill events,
  empty-only vs overwrite, rate-once, re-find by label, never clicks or submits, challenge, login
  and the captcha false positive.
- **`score`:** reasons, scam rules, the exact-country regression, filter misses, overlap, age.
- **`proposal`:** rates, prompt rules, tolerant JSON, layout safety net (including the greeting
  fix), finishDraft, template, brief questions.
- **`worker`** (end to end):
  - no access without a click;
  - a job page doesn't call the AI;
  - job page → draft → proposal page auto-fill with no second AI call, rate once, then a manual
    overwrite;
  - straight to the proposal page;
  - auto-fill off;
  - challenge stop;
  - AI 500 and no key → template;
  - a raw-newline one-block reply;
  - status, edits and delete;
  - manifest permission guard plus version sync.
- **`popup`:** the real popup → worker → page in jsdom: the fill banner, the placeholder note,
  draft fields, settings saved into `filters`, the Jobs tab, no errors.

### Roadmap
- **v0.2:** replace the assumed fixtures with your snapshots, fix the patterns, and verify the
  proposal-form roles (and whether milestones or "By project" need handling).
- **v0.3:** history import of past proposals the safe way. Options include a one-off file the
  user exports, or a snapshot of "My proposals" taken on click. Plus outcome stats.
- **v0.4:** the on-device model (hired vs not; reply vs not), feature toggles, and Connects
  budgeting by expected wins per Connect, ported from AutoBidder's `bg/ml.js`. Optional AI
  review, never allowed to raise Connects budgets.
- **If the account qualifies for an API key:** official-API job discovery within the approved
  scope, kept modest, never via browser cookies.
