// AI providers (your own key): Gemini and OpenRouter, with a primary → secondary switch when
// one is rate limited. Carried over from AutoBidder; keys go in headers, never URLs.
import { AI_TIMEOUT_MS } from '../shared/constants.js';
import { timedFetch } from './http.js';
import { log } from './log.js';
import { todayStr } from './util.js';
import { checkKey } from '../shared/keys.js';

const RATE_LIMIT_PAUSE_MS = 60_000;
const limitedUntil = { gemini: 0, openrouter: 0 };

function aiError(reason, message) { const e = new Error(message || reason); e.reason = reason; return e; }

export async function callGemini(apiKey, model, prompt, { maxTokens = 8192, temperature = 0.85, json = true } = {}) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent`;
  let res;
  try {
    res = await timedFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      // responseMimeType makes Gemini return strict JSON. The output budget is generous because
      // thinking models count their reasoning against maxOutputTokens.
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: maxTokens, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
    }, AI_TIMEOUT_MS, 'Gemini request');
  } catch (e) { throw aiError(e.reason === 'timeout' ? 'timeout' : 'network', e.message); }
  const body = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(body)?.error?.message || msg; } catch (_) {}
    if (res.status === 429) { setLimited('gemini'); throw aiError('rate_limit', msg); }
    if (res.status === 400 && /api key/i.test(msg) || res.status === 401 || res.status === 403) throw aiError('auth', `Gemini rejected the key (${msg}) — check Settings → Gemini API key.`);
    throw aiError('error', `Gemini: ${msg}`);
  }
  const data = JSON.parse(body);
  const cand = data?.candidates?.[0];
  if (!cand) throw aiError('error', `Gemini returned no answer (${data?.promptFeedback?.blockReason || 'unknown reason'})`);
  const text = (cand.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw aiError(cand.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'error', `Gemini returned empty text (${cand.finishReason || '?'})`);
  if (cand.finishReason === 'MAX_TOKENS') log('Gemini hit its output limit — the reply may be cut short.', 'warn');
  return text;
}

export async function callOpenRouter(apiKey, model, prompt, { maxTokens = 8192, temperature = 0.85 } = {}) {
  let res;
  try {
    res = await timedFetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-Title': 'Proposal Assistant' },
      body: JSON.stringify({ model: model || 'google/gemini-2.5-flash', messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature }),
    }, AI_TIMEOUT_MS, 'OpenRouter request');
  } catch (e) { throw aiError(e.reason === 'timeout' ? 'timeout' : 'network', e.message); }
  const body = await res.text();
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = JSON.parse(body)?.error?.message || msg; } catch (_) {}
    if (res.status === 429) { setLimited('openrouter'); throw aiError('rate_limit', msg); }
    if (res.status === 401) throw aiError('auth', `OpenRouter rejected the key (${msg}) — check Settings → OpenRouter API key; it should start with "sk-or-v1-".`);
    throw aiError('error', `OpenRouter: ${msg}`);
  }
  const text = JSON.parse(body)?.choices?.[0]?.message?.content?.trim();
  if (!text) throw aiError('error', 'OpenRouter returned empty content');
  return text;
}

function setLimited(p) {
  limitedUntil[p] = Date.now() + RATE_LIMIT_PAUSE_MS;
  log(`${p === 'openrouter' ? 'OpenRouter' : 'Gemini'} is rate limiting — pausing it for a minute.`, 'warn');
}

// A key of the wrong kind (e.g. a Gemini key in the OpenRouter field) is treated as missing and
// logged once per call, instead of being sent and failing with a confusing 401.
export function resolveProvider(cfg, now = Date.now()) {
  const primary = cfg.aiProvider === 'openrouter' ? 'openrouter' : 'gemini';
  const secondary = primary === 'gemini' ? 'openrouter' : 'gemini';
  const key = p => {
    const { key: k, error } = checkKey(p, p === 'gemini' ? cfg.geminiApiKey : cfg.openrouterApiKey);
    if (error) { log(`Not using the ${p === 'gemini' ? 'Gemini' : 'OpenRouter'} key: ${error}`, 'warn'); return ''; }
    return k;
  };
  if (key(primary) && limitedUntil[primary] <= now) return primary;
  if (key(secondary) && limitedUntil[secondary] <= now) { if (key(primary)) log(`${primary} unavailable — using ${secondary}.`, 'warn'); return secondary; }
  return null;
}

export async function callAI(cfg, prompt, opts = {}) {
  const provider = resolveProvider(cfg);
  if (!provider) {
    const anyValid = ['gemini', 'openrouter'].some(p => { const r = checkKey(p, p === 'gemini' ? cfg.geminiApiKey : cfg.openrouterApiKey); return r.key && !r.error; });
    throw aiError(anyValid ? 'rate_limit' : 'no_key', anyValid ? 'Both AI providers are rate limited — try again in a minute.' : 'No usable AI key — check Settings.');
  }
  bumpUsage(provider);
  const text = provider === 'openrouter'
    ? await callOpenRouter(cfg.openrouterApiKey, cfg.openrouterModel, prompt, opts)
    : await callGemini(cfg.geminiApiKey, cfg.geminiModel, prompt, opts);
  return { text, provider };
}

export async function testProvider(provider, rawKey, model) {
  const { key, error } = checkKey(provider, rawKey);
  if (error) return { ok: false, error };
  if (!key) return { ok: false, error: 'Enter a key first.' };
  try {
    const text = provider === 'openrouter'
      ? await callOpenRouter(key, model, 'Reply with the single word OK.', { maxTokens: 512, temperature: 0 })
      : await callGemini(key, model, 'Reply with the single word OK.', { maxTokens: 512, temperature: 0, json: false });
    return { ok: true, sample: text.slice(0, 40) };
  } catch (e) { return { ok: false, error: e.message }; }
}

function bumpUsage(provider) {
  chrome.storage.local.get('aiUsage', d => {
    let u = d.aiUsage;
    if (!u || u.date !== todayStr()) u = { date: todayStr(), gemini: 0, openrouter: 0 };
    u[provider] = (u[provider] || 0) + 1;
    chrome.storage.local.set({ aiUsage: u });
  });
}

export function _resetLimits() { limitedUntil.gemini = 0; limitedUntil.openrouter = 0; }
