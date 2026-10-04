// preview-shim.js — when popup.html is opened OUTSIDE the extension (a normal browser tab, for
// design preview), chrome.* doesn't exist. This mocks just enough of it, with demo data, so the
// whole UI renders. Inside the real extension it is a complete no-op.
(function () {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return;
  document.body.classList.add('preview');
  const now = Date.now(), min = 60000;
  const draft = {
    coverLetter: "Hi,\n\nYou need the WooCommerce checkout to stop dropping the shipping zone when a customer edits their postcode, and you mentioned it only happens with the Table Rate plugin active. I fix WooCommerce checkout and shipping logic day to day.\n\nI'd reproduce it on a staging copy first, then trace the AJAX update_order_review call to see which hook clears the zone. Most likely it's a priority clash in woocommerce_package_rates; I'd patch it in a small custom plugin rather than editing Table Rate, so updates don't undo the fix. The one thing I won't skip is testing every zone you ship to, not just the one in the report.\n\n$45/hr, and I expect this to take 3–5 hours including the staging test and a short write-up of the change.\n\nCan you share which Table Rate version you're on, so I can match it on staging?",
    answers: ["Yes. Most of my recent work is WooCommerce shipping and checkout fixes, including Table Rate conflicts like this one. [link to a similar fix]", "I'd start on a staging copy within a day of hiring, and you'd have the fix and a short write-up within 2 days."],
    questions: ['Have you worked with WooCommerce Table Rate Shipping before?', 'How soon could you start, and when would we see a fix?'],
    duration: 'Less than 1 month', rate: 45, unit: 'hourly', source: 'ai', provider: 'gemini', words: 158,
    placeholders: ['[link to a similar fix]'], banned: [], assessment: { fit: 0.86, clarity: 0.8, risk: 0.05, flags: [] }, createdAt: now - 3 * min,
  };
  const job = {
    id: '~021234567890123456789', title: 'Fix WooCommerce checkout losing shipping zone (Table Rate plugin)', url: 'https://www.upwork.com/jobs/~021234567890123456789',
    jobType: 'hourly', hourlyMin: 30, hourlyMax: 60, experience: 'intermediate', postedAt: now - 38 * min, proposals: '5 to 10', interviewing: 0, invitesSent: 2, connects: 12,
    client: { paymentVerified: true, totalSpent: 48000, hires: 31, hireRate: 82, rating: 4.9, reviews: 22, avgHourlyPaid: 38, country: 'Canada', memberSince: 'Mar 4, 2019' },
    status: 'filled', updatedAt: now - 2 * min, draft,
    score: { score: 84, scams: [], misses: [], reasons: [
      { pts: 8, text: 'payment verified', tone: 'good' }, { pts: 8, text: 'client spent $48K', tone: 'good' }, { pts: 8, text: '82% hire rate', tone: 'good' },
      { pts: 5, text: 'client rated 4.9', tone: 'good' }, { pts: 8, text: '5 to 10 proposals', tone: 'good' }, { pts: 3, text: 'nobody interviewing yet', tone: 'good' },
      { pts: 8, text: 'posted 38 min ago', tone: 'good' }, { pts: 12, text: 'matches WooCommerce, PHP, WordPress', tone: 'good' }] },
  };
  const others = [
    { id: '~02a', title: 'Elementor landing page from Figma', status: 'submitted', updatedAt: now - 300 * min, statusAt: now - 300 * min, score: { score: 71 }, draft: { ...draft, source: 'ai' } },
    { id: '~02b', title: 'Migrate Shopify store to WooCommerce', status: 'interview', updatedAt: now - 2000 * min, statusAt: now - 1500 * min, score: { score: 77 } },
    { id: '~02c', title: 'Data entry — copy 500 products (crypto payment)', status: 'skipped', updatedAt: now - 3000 * min, score: { score: 18 } },
    { id: '~02d', title: 'Speed up a slow WordPress site', status: 'drafted', updatedAt: now - 90 * min, score: { score: 66 }, draft: { ...draft, source: 'ai' } },
  ];
  const store = {
    jobs: Object.fromEntries([job, ...others].map(j => [j.id, j])),
    activityLog: [
      { ts: now - 4 * min, type: 'info', msg: 'Read proposal page: "Fix WooCommerce checkout losing shipping zone (Table Rate plugin)" — score 84' },
      { ts: now - 3 * min, type: 'info', msg: 'Drafted with gemini: "Fix WooCommerce checkout…" — 158 words, 2/2 answers, $45/hr · fill in 1 placeholder(s)' },
      { ts: now - 3 * min, type: 'info', msg: 'Auto-filled "Fix WooCommerce checkout…": cover letter, 2/2 answers, rate $45. Review, set the duration, and click Submit yourself.' },
      { ts: now - 1 * min, type: 'warn', msg: 'Stopped: Upwork is showing a verification / challenge page. Nothing was read or filled.' },
    ],
    profileSkills: 'WordPress, WooCommerce, PHP, Elementor', hourlyRate: 45, autoFill: true, fillRate: true,
  };
  const pick = keys => { const o = {}; (keys == null ? Object.keys(store) : [].concat(keys)).forEach(k => { if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); }); return o; };
  const area = { get: (k, cb) => { const r = pick(k); return cb ? cb(r) : Promise.resolve(r); }, set: (o, cb) => { Object.assign(store, o); return cb ? cb() : Promise.resolve(); }, remove: () => Promise.resolve() };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const handlers = {
    ASSIST: async () => { await delay(400); return { kind: 'apply', job: store.jobs[job.id], fill: { ok: true, done: ['cover', 'q1', 'q2', 'rate'], unanswered: 0, duration: draft.duration } }; },
    DRAFT: async m => { await delay(900); return store.jobs[m.jobId]; },
    FILL: async () => ({ ok: true, done: ['cover', 'q1', 'q2'], unanswered: 0 }),
    SET_STATUS: async m => { store.jobs[m.jobId].status = m.status; return store.jobs[m.jobId]; },
    SAVE_DRAFT: async m => store.jobs[m.jobId],
    TEST_AI: async () => ({ ok: true }),
  };
  window.chrome = {
    runtime: {
      getManifest: () => ({ version: '0.1.3' }),
      sendMessage: async m => { const h = handlers[m.type]; return h ? { ok: true, result: await h(m) } : { ok: true, result: null }; },
      onMessage: { addListener: () => {} },
    },
    storage: { local: area, session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [{ id: 1, url: 'https://www.upwork.com/nx/proposals/job/~021234567890123456789/apply/' }] },
  };
})();
