// Small pure helpers.
export function sleep(ms)           { return new Promise(r => setTimeout(r, ms)); }
export function todayStr()          { return new Date().toISOString().slice(0, 10); }
export function clamp(v, lo, hi)    { return Math.max(lo, Math.min(hi, v)); }
export function num(v)              { const n = parseFloat(v); return isFinite(n) ? n : 0; }
export function storageGet(keys)    { return new Promise(r => chrome.storage.local.get(keys, r)); }
export function storageSet(obj)     { return new Promise(r => chrome.storage.local.set(obj, r)); }
