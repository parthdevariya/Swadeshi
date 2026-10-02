// User settings, stored only in this browser.

import { DEFAULT_GEMINI_MODEL } from './imageAI.js';

const KEY = 'swadeshi-settings-v1';

export const DEFAULTS = {
  provider: 'off', // 'off' | 'gemini' | 'vision' | 'both'
  geminiKey: '',
  geminiModel: DEFAULT_GEMINI_MODEL,
  visionKey: '',
};

export function loadSettings(storage) {
  try {
    const s = storage ?? globalThis.localStorage;
    return { ...DEFAULTS, ...JSON.parse(s?.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings, storage) {
  const clean = {
    provider: ['off', 'gemini', 'vision', 'both'].includes(settings.provider) ? settings.provider : 'off',
    geminiKey: String(settings.geminiKey || '').trim(),
    geminiModel: String(settings.geminiModel || '').trim() || DEFAULT_GEMINI_MODEL,
    visionKey: String(settings.visionKey || '').trim(),
  };
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Storage blocked — settings last for this visit only.
  }
  return clean;
}
