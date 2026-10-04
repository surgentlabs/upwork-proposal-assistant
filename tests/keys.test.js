import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanKey, keyKind, checkKey } from '../shared/keys.js';

test('pasted keys are normalised: "Bearer ", "Authorization:", quotes, whitespace', () => {
  assert.equal(cleanKey('Bearer sk-or-v1-abc'), 'sk-or-v1-abc');
  assert.equal(cleanKey('Authorization: Bearer sk-or-v1-abc\n'), 'sk-or-v1-abc');
  assert.equal(cleanKey('  "sk-or-v1-a bc"  '), 'sk-or-v1-abc');
  assert.equal(cleanKey(undefined), '');
});

test('wrong-kind keys are named (OpenRouter answers "Missing Authentication header" for all of these)', () => {
  assert.equal(keyKind('sk-or-v1-x'), 'openrouter');
  assert.equal(keyKind('AIzaSyX'), 'gemini');
  assert.equal(keyKind('sk-ant-api03-x'), 'anthropic');
  assert.equal(keyKind('sk-proj-x'), 'openai');
  assert.match(checkKey('openrouter', 'AIzaSyX').error, /isn't an OpenRouter key — it looks like a Google Gemini key.*sk-or-v1-/);
  assert.match(checkKey('openrouter', 'sk-ant-x').error, /Anthropic/);
  assert.match(checkKey('openrouter', 'hunter2').error, /isn't an OpenRouter key\./);   // e.g. a password autofilled by Chrome
  assert.deepEqual(checkKey('openrouter', 'Bearer sk-or-v1-ok'), { key: 'sk-or-v1-ok', error: null });
  assert.match(checkKey('gemini', 'sk-or-v1-x').error, /looks like an OpenRouter key/);
  assert.deepEqual(checkKey('gemini', 'AIzaOK'), { key: 'AIzaOK', error: null });
  assert.deepEqual(checkKey('gemini', 'some-new-format'), { key: 'some-new-format', error: null });   // unknown shapes allowed for Gemini
  assert.deepEqual(checkKey('openrouter', ''), { key: '', error: null });
});
