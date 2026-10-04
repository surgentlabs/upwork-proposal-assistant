// API key hygiene. OpenRouter answers "Missing Authentication header" for ANY bearer token that
// isn't an OpenRouter key (checked 2026-10-05: empty, "Bearer Bearer …", AIza…, sk-ant-… all get
// it), so a key pasted into the wrong field looked like a bug in the extension. Normalise what
// was pasted and say plainly when it's the wrong kind of key.

export function cleanKey(raw) {
  return String(raw || '').replace(/^\s*(authorization:\s*)?bearer\s+/i, '').replace(/\s+/g, '').replace(/^["']|["']$/g, '');
}

export function keyKind(key) {
  if (/^sk-or-/i.test(key)) return 'openrouter';
  if (/^AIza/.test(key)) return 'gemini';
  if (/^sk-ant-/i.test(key)) return 'anthropic';
  if (/^sk-/i.test(key)) return 'openai';
  return 'unknown';
}

const NAMES = { openrouter: 'an OpenRouter key', gemini: 'a Google Gemini key', anthropic: 'an Anthropic key', openai: 'an OpenAI key' };

// → { key, error }   error = a message to show; the key must not be used when set.
export function checkKey(provider, raw) {
  const key = cleanKey(raw);
  if (!key) return { key: '', error: null };
  const kind = keyKind(key);
  if (provider === 'openrouter' && kind !== 'openrouter')
    return { key, error: `That isn't an OpenRouter key${NAMES[kind] ? ` — it looks like ${NAMES[kind]}` : ''}. OpenRouter keys start with "sk-or-v1-" (openrouter.ai/keys).` };
  if (provider === 'gemini' && kind !== 'gemini' && kind !== 'unknown')
    return { key, error: `That isn't a Gemini key — it looks like ${NAMES[kind]}. Gemini keys start with "AIza" (aistudio.google.com/apikey).` };
  return { key, error: null };
}
