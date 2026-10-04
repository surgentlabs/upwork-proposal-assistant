// Activity log, owned by the worker. Writes are serialised through a promise chain and
// coalesced (a burst of lines becomes one storage write), capped at LOG_CAP entries.
import { LOG_CAP } from '../shared/constants.js';

let pendingLog = [];
let logFlush = Promise.resolve();

export function log(text, level = 'info') {
  console.log(`[ProposalAssistant] ${text}`);
  const entry = { msg: text, type: level, ts: Date.now() };
  chrome.runtime.sendMessage({ type: 'LOG', entry }).catch(() => {});   // live update if the popup is open
  pendingLog.push(entry);
  logFlush = logFlush.then(flushLog).catch(() => {});
  return logFlush;
}

async function flushLog() {
  if (!pendingLog.length) return;
  const batch = pendingLog; pendingLog = [];
  const { activityLog } = await new Promise(r => chrome.storage.local.get('activityLog', r));
  const merged = [...(Array.isArray(activityLog) ? activityLog : []), ...batch].slice(-LOG_CAP);
  await new Promise(r => chrome.storage.local.set({ activityLog: merged }, r));
}

export function clearLog() {
  pendingLog = [];
  logFlush = logFlush.then(() => new Promise(r => chrome.storage.local.set({ activityLog: [] }, r))).catch(() => {});
  return logFlush;
}

export function whenLogged() { return logFlush; }
