// In-page agent, injected with chrome.scripting.executeScript({ func: pageAgent, args }) into
// the tab YOU opened, only when you open the popup (activeTab). It must stay self-contained:
// executeScript serialises the function, so nothing outside its body is in scope.
//
//   pageAgent('read')            → { url, title, description, mainText, fields[], blocked }  (+ tile, panelSource on /details/~id)
//   pageAgent('fill', { items }) → { results[] }   items: [{ index, label, value, overwrite }]
//   pageAgent('feed')            → { url, tiles[] }   the job tiles already on a feed / search page
//
// It reads visible text and form fields, and sets field values. It NEVER clicks, submits,
// navigates or sends a request — the proposal is only sent when you press Submit yourself.
export function pageAgent(action, payload) {
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const textOf = el => (el ? (typeof el.innerText === 'string' ? el.innerText : el.textContent) || '' : '');

  const isHidden = el => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n.hidden || n.getAttribute('aria-hidden') === 'true') return true;
      const cs = window.getComputedStyle ? window.getComputedStyle(n) : null;
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return true;
    }
    return false;
  };

  // Best label for a form field: explicit <label for>, aria-labelledby, aria-label, a wrapping
  // <label>, then the nearest preceding text block in the field's ancestors (how Upwork lays
  // out screening questions above their textareas).
  const labelOf = el => {
    if (el.id) {
      const l = [...document.querySelectorAll('label')].find(x => x.htmlFor === el.id);
      if (l && clean(textOf(l))) return clean(textOf(l));
    }
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const s = clean(lb.split(/\s+/).map(id => textOf(document.getElementById(id))).join(' '));
      if (s) return s;
    }
    const al = clean(el.getAttribute('aria-label'));
    if (al) return al;
    const wrap = el.closest('label');
    if (wrap && clean(textOf(wrap))) return clean(textOf(wrap));
    let node = el;
    for (let depth = 0; depth < 5 && node; depth++) {
      let sib = node.previousElementSibling;
      for (let k = 0; k < 4 && sib; k++, sib = sib.previousElementSibling) {
        if (sib.querySelector && sib.querySelector('textarea, input, select, [contenteditable="true"]')) break;
        const s = clean(textOf(sib));
        if (s) return s.slice(0, 400);
      }
      node = node.parentElement;
    }
    return clean(el.getAttribute('placeholder')) || clean(el.getAttribute('name'));
  };

  const root = document.querySelector('main') || document.body;
  const fieldEls = () => [...root.querySelectorAll('textarea, input, [contenteditable="true"]')].filter(el => {
    if (el.tagName === 'INPUT') {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (!['text', 'number', 'tel', ''].includes(t)) return false;
    }
    return !el.disabled && !el.readOnly && !isHidden(el);
  });
  // Job links and tiles (feed / search pages). A tile is the largest ancestor of a job link that
  // contains links to that one job only — structure-agnostic, no class names.
  const idOf = h => { const m = String(h || '').match(/~(0[0-9a-z]{9,})/i); return m ? m[1].toLowerCase() : null; };
  const jobLinks = el => [...el.querySelectorAll('a[href*="~0"]')].filter(a => idOf(a.getAttribute('href')) && /\/jobs\/|\/details\/|\/apply\//i.test(a.getAttribute('href')));
  const idsIn = el => new Set(jobLinks(el).map(a => idOf(a.getAttribute('href'))));
  const tileOf = a => {
    const id = idOf(a.getAttribute('href'));
    let node = a;
    while (node.parentElement && node.parentElement !== document.body && idsIn(node.parentElement).size <= 1) node = node.parentElement;
    const desc = node.querySelector('[data-test="Description"], [data-test*="job-description" i], [data-test*="JobDescription" i]');
    return { id: `~${id}`, href: new URL(a.getAttribute('href'), location.href).href, title: clean(textOf(a)), text: textOf(node).slice(0, 6000), description: textOf(desc).trim().slice(0, 4000) };
  };

  const describe = (el, index) => ({
    index,
    kind: el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'INPUT' ? 'input' : 'rich',
    label: labelOf(el),
    placeholder: clean(el.getAttribute('placeholder')),
    hasValue: !!clean(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : textOf(el)),
    value: el.tagName === 'INPUT' ? String(el.value || '').slice(0, 40) : '',   // inputs only (rate); text you typed is never read back
    maxLength: el.maxLength > 0 ? el.maxLength : null,
  });

  if (action === 'read') {
    // Challenge / auth-wall detection. Phrases are only trusted on a short page (an interstitial),
    // so a job brief that merely mentions "captcha" doesn't count.
    const bodyText = textOf(document.body);
    const title = document.title.toLowerCase();
    const shortPage = bodyText.length < 2500 ? bodyText.toLowerCase() : '';
    let blocked = null;
    if (/just a moment|attention required|access denied/.test(title) ||
        /verify you are human|checking your browser|unusual activity|are you a robot|captcha/.test(shortPage) ||
        document.querySelector('iframe[src*="captcha" i], iframe[src*="challenge" i], #challenge-form')) blocked = 'challenge';
    else if (/\/account-security\/login|^\/login\b/.test(location.pathname) || /log in to upwork/.test(shortPage)) blocked = 'login';
    const DESC = '[data-test="Description"], [data-test="job-description-text"], [data-test="description"]';
    // Job-details slide-over on the feed (/nx/find-work/…/details/~id — verified 2026-10-05): the
    // panel renders OUTSIDE <main>, which holds the feed. Never take "the first description on the
    // page" there — it belongs to another job. Read the panel (a dialog outside <main>, else the
    // page text minus the feed) plus the feed tile whose link has this job's id.
    const detailId = (location.pathname.match(/\/details\/~(0[0-9a-z]{9,})/i) || [])[1];
    if (detailId) {
      const id = detailId.toLowerCase();
      const main = document.querySelector('main');
      const panel = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
        .find(el => !(main && (main.contains(el) || el.contains(main))) && /About the client|Activity on this job|Skills and Expertise|Apply now/i.test(textOf(el)));
      const PANEL_RE = /About the client|Activity on this job|Skills and Expertise/i;
      let panelText = '';
      if (panel) panelText = textOf(panel);
      else if (main) {
        // Page text minus the feed — only if the feed text really came out, and only if what's left
        // looks like job details (the site header and footer are outside <main> too).
        const mt = textOf(main);
        const rest = mt && bodyText.includes(mt) ? bodyText.replace(mt, '\n') : '';
        if (PANEL_RE.test(rest)) panelText = rest;
      }
      const outsideDesc = [...document.querySelectorAll(DESC)].find(el => !(main && main.contains(el)));
      const link = jobLinks(document).find(a => idOf(a.getAttribute('href')) === id);
      const tile = link ? tileOf(link) : null;
      const ph = panel && panel.querySelector('h1, h2, h3, h4, [data-test="job-title"]');
      return {
        url: location.href,
        title: clean(textOf(ph)) || tile?.title || '',
        description: (textOf(panel ? panel.querySelector(DESC) : outsideDesc).trim() || tile?.description || '').slice(0, 12000),
        mainText: panelText.slice(0, 40000),
        fields: fieldEls().map(describe),
        blocked,
        tile,
        panelSource: panel ? 'dialog' : panelText ? 'outside-main' : 'none',
      };
    }
    const descEl = document.querySelector(DESC);
    const h1 = document.querySelector('h1, [data-test="job-title"]');
    return {
      url: location.href,
      title: clean(textOf(h1)) || clean(document.title.split(' - ')[0]),
      description: textOf(descEl).trim().slice(0, 12000),
      mainText: textOf(root).slice(0, 40000),
      fields: fieldEls().map(describe),
      blocked,
    };
  }

  if (action === 'fill') {
    const setValue = (el, value) => {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, value); else el.value = value;   // native setter so Vue/React see the change
      } else {
        el.textContent = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const els = fieldEls();
    const results = [];
    // Hard guard: never touch a field about Connects / boosting / ranking — the proposal page's
    // "Boost your proposal" bid spends Connects. Same rule as SPENDS_CONNECTS_RE in shared/form.js
    // (duplicated because this function must be self-contained).
    const spendsConnects = el => el.tagName === 'INPUT' && /connects?\b|boost|\brank(ed)?\b|1st place/i.test(`${labelOf(el)} ${el.getAttribute('placeholder') || ''}`);
    for (const item of (payload && payload.items) || []) {
      let el = els[item.index];
      // The page may have re-rendered since it was read: confirm the label, else find it by label.
      if (!el || (item.label && clean(labelOf(el)) !== clean(item.label))) {
        el = item.label ? els.find(x => clean(labelOf(x)) === clean(item.label)) : null;
      }
      if (!el) { results.push({ index: item.index, role: item.role, ok: false, reason: 'field not found' }); continue; }
      if (spendsConnects(el)) { results.push({ index: item.index, role: item.role, ok: false, reason: 'refused: Connects / boost field' }); continue; }
      const current = clean(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : textOf(el));
      if (current && !item.overwrite) { results.push({ index: item.index, role: item.role, ok: false, reason: 'already has text' }); continue; }
      let value = String(item.value ?? '');
      if (el.maxLength > 0 && value.length > el.maxLength) value = value.slice(0, el.maxLength);
      setValue(el, value);
      results.push({ index: item.index, role: item.role, ok: true });
    }
    return { results };
  }

  // Job tiles on a feed / search page: each tile is the largest ancestor of a job link that
  // contains links to that one job only — structure-agnostic, no class names. Reads what's
  // already on the page; never clicks "Load More Jobs".
  if (action === 'feed') {
    const seen = new Set();
    const tiles = [];
    for (const a of jobLinks(document)) {
      const id = idOf(a.getAttribute('href'));
      if (seen.has(id)) continue;
      seen.add(id);
      tiles.push(tileOf(a));
      if (tiles.length >= 60) break;
    }
    return { url: location.href, tiles };
  }

  return { error: `unknown action ${action}` };
}
