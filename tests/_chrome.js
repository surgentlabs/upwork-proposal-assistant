// Test doubles: a stateful `chrome` API, a fetch router, and a jsdom page that the real
// pageAgent runs against (executeScript calls the function with the page's globals installed).
import { JSDOM } from 'jsdom';

export function installChrome({ manifest = {} } = {}) {
  const store = {}, session = {};
  const sent = [], listeners = { message: [] };
  const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const pick = (src, keys) => {
    const out = {};
    const list = keys == null ? Object.keys(src) : Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
    for (const k of list) if (k in src) out[k] = clone(src[k]);
    return out;
  };
  const area = src => ({
    get: (keys, cb) => { const r = pick(src, keys); return cb ? cb(r) : Promise.resolve(r); },
    set: (obj, cb) => { Object.assign(src, clone(obj)); return cb ? cb() : Promise.resolve(); },
    remove: (keys, cb) => { [].concat(keys).forEach(k => delete src[k]); return cb ? cb() : Promise.resolve(); },
  });
  const executed = [];
  const chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.0-test', ...manifest }),
      sendMessage: m => { sent.push(m); return Promise.resolve(); },
      onMessage: { addListener: fn => listeners.message.push(fn) },
      onInstalled: { addListener: () => {} },
    },
    storage: { local: area(store), session: area(session) },
    scripting: {
      // Default: no access (like a tab the user hasn't clicked the icon on). Tests set `page`.
      executeScript: async ({ target, func, args }) => {
        executed.push({ tabId: target.tabId, action: args[0] });
        if (!chrome._page) throw new Error('Cannot access contents of the page. Extension manifest must request permission to access the respective host.');
        return [{ result: chrome._page.run(func, args) }];
      },
    },
    tabs: { query: async () => [{ id: 7 }] },
  };
  globalThis.chrome = chrome;
  // Send a message to the worker the way the popup does; resolves with the response.
  const message = msg => new Promise(resolve => {
    const fn = listeners.message[0];
    const keep = fn(msg, {}, resolve);
    if (keep !== true) resolve(undefined);
  });
  return { chrome, store, session, sent, executed, message, setPage: p => { chrome._page = p; } };
}

// A jsdom page. run(func, args) installs the page's globals, calls func, restores them.
export function makePage(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const w = dom.window;
  const clicks = [], submits = [];
  w.HTMLElement.prototype.click = function () { clicks.push(this.outerHTML.slice(0, 80)); };
  w.document.addEventListener('submit', e => { submits.push(e.target); e.preventDefault(); }, true);
  const events = [];
  for (const t of ['input', 'change']) w.document.addEventListener(t, e => events.push({ type: t, tag: e.target.tagName, name: e.target.getAttribute('name') || e.target.id }), true);
  const G = ['window', 'document', 'location', 'HTMLTextAreaElement', 'HTMLInputElement', 'Event'];
  const run = (func, args) => {
    const saved = {};
    for (const g of G) { saved[g] = Object.getOwnPropertyDescriptor(globalThis, g); }
    for (const g of G) Object.defineProperty(globalThis, g, { value: g === 'window' ? w : w[g], configurable: true, writable: true });
    try { return JSON.parse(JSON.stringify(func(...args) ?? null)); }   // executeScript results are structured-cloned
    finally { for (const g of G) { if (saved[g]) Object.defineProperty(globalThis, g, saved[g]); else delete globalThis[g]; } }
  };
  return { dom, w, doc: w.document, run, clicks, submits, events };
}

export function installFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  return calls;
}
export const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
export const geminiReply = obj => jsonRes({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] });
