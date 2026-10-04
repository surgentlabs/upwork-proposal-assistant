// In-page agent, injected with chrome.scripting.executeScript({ func: pageAgent, args }) into
// the tab YOU opened, only when you open the popup (activeTab). It must stay self-contained:
// executeScript serialises the function, so nothing outside its body is in scope.
//
//   pageAgent('read')            → { url, title, description, mainText, fields[], blocked }
//   pageAgent('fill', { items }) → { results[] }   items: [{ index, label, value, overwrite }]
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
    const descEl = document.querySelector('[data-test="Description"], [data-test="job-description-text"], [data-test="description"]');
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
    for (const item of (payload && payload.items) || []) {
      let el = els[item.index];
      // The page may have re-rendered since it was read: confirm the label, else find it by label.
      if (!el || (item.label && clean(labelOf(el)) !== clean(item.label))) {
        el = item.label ? els.find(x => clean(labelOf(x)) === clean(item.label)) : null;
      }
      if (!el) { results.push({ index: item.index, role: item.role, ok: false, reason: 'field not found' }); continue; }
      const current = clean(el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : textOf(el));
      if (current && !item.overwrite) { results.push({ index: item.index, role: item.role, ok: false, reason: 'already has text' }); continue; }
      let value = String(item.value ?? '');
      if (el.maxLength > 0 && value.length > el.maxLength) value = value.slice(0, el.maxLength);
      setValue(el, value);
      results.push({ index: item.index, role: item.role, ok: true });
    }
    return { results };
  }

  return { error: `unknown action ${action}` };
}
