// Config loader: storage + session-only keys + defaults.
import { SETTINGS_DEFAULTS, SETTINGS_KEYS, FILTER_DEFAULTS } from '../shared/constants.js';

export async function getConfig() {
  const [d, sess] = await Promise.all([
    new Promise(r => chrome.storage.local.get(SETTINGS_KEYS, r)),
    new Promise(r => (chrome.storage.session?.get ? chrome.storage.session.get(['geminiApiKey', 'openrouterApiKey'], r) : r({}))),
  ]);
  const cfg = { ...SETTINGS_DEFAULTS };
  for (const k of SETTINGS_KEYS) if (d[k] !== undefined && d[k] !== null) cfg[k] = d[k];
  cfg.filters = { ...FILTER_DEFAULTS, ...(d.filters || {}) };
  cfg.geminiApiKey = sess.geminiApiKey || cfg.geminiApiKey || '';         // a non-empty session key wins
  cfg.openrouterApiKey = sess.openrouterApiKey || cfg.openrouterApiKey || '';
  cfg.hourlyRate = Number(cfg.hourlyRate) || 0;
  cfg.fixedBidRatio = Number(cfg.fixedBidRatio) || 1;
  cfg.minFixedBid = Number(cfg.minFixedBid) || 0;
  return cfg;
}

export function skillList(cfg) {
  return String(cfg.profileSkills || '').split(',').map(s => s.trim()).filter(Boolean);
}
