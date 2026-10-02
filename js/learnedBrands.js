// Brands the app has learned from the web, saved on this device.
//
// When a brand isn't in the curated list (brands.js), the app researches it on
// Wikidata and stores the result here, so the next scan is instant and works
// offline. The curated list always wins over learned entries, and learned
// entries can be removed by the user or proposed for the shared list.

import { AMBIGUOUS_NAMES } from './brands.js';
import { normalizeText } from './textParser.js';
import { cleanCompanyName } from './webLookup.js';

const KEY = 'swadeshi-learned-brands-v1';
export const REPO = 'parthdevariya/Swadeshi';

function storageOr(storage) {
  try {
    return storage ?? globalThis.localStorage ?? null;
  } catch {
    return null; // access can throw in privacy modes
  }
}

export function loadLearned(storage) {
  const s = storageOr(storage);
  try {
    const list = JSON.parse(s?.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list, storage) {
  try {
    storageOr(storage)?.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked — learning is best-effort.
  }
  return list;
}

/** Names worth matching later: distinctive, not everyday words, not numbers. */
function usableName(n) {
  const k = normalizeText(n);
  return k.length >= 3 && /[a-z]{3}/.test(k) && !AMBIGUOUS_NAMES.has(k);
}

/** Build a learned-brand record from a Wikidata research result. */
export function makeLearnedEntry(web, { aliases = [], category = null, now = Date.now() } = {}) {
  const names = [web.name, cleanCompanyName(web.query || ''), ...aliases.map(cleanCompanyName)]
    .map((n) => String(n || '').trim())
    .filter(usableName);
  const seen = new Set();
  const unique = names.filter((n) => {
    const k = normalizeText(n);
    return !seen.has(k) && seen.add(k);
  });
  return {
    name: web.name,
    aliases: unique.filter((n) => normalizeText(n) !== normalizeText(web.name)),
    owner: web.owner,
    country: web.ownerCountry,
    indian: web.ownerCountry === 'India',
    category,
    note: null,
    chain: web.chain || [web.name],
    wikidataUrl: web.wikidataUrl || null,
    learned: true,
    addedAt: now,
  };
}

/** Add or update a learned brand. Returns the new list. */
export function learnBrand(entry, storage) {
  const key = normalizeText(entry.name);
  const list = loadLearned(storage);
  const old = list.find((b) => normalizeText(b.name) === key);
  const merged = old
    ? { ...entry, aliases: [...new Set([...(old.aliases || []), ...entry.aliases])], addedAt: old.addedAt }
    : entry;
  return save([merged, ...list.filter((b) => normalizeText(b.name) !== key)], storage);
}

export function forgetBrand(name, storage) {
  const key = normalizeText(name);
  return save(loadLearned(storage).filter((b) => normalizeText(b.name) !== key), storage);
}

function q(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** The exact line a maintainer would paste into brands.js. */
export function toBrandsJsLine(b) {
  const names = `[${[b.name, ...(b.aliases || [])].map(q).join(', ')}]`;
  const cat = q(b.category || 'packaged-food');
  return b.indian
    ? `I(${q(b.owner)}, ${cat}, ${names}),`
    : `F(${q(b.owner)}, ${q(b.country)}, ${cat}, ${names}),`;
}

/** Pre-filled GitHub issue proposing the brand for the shared, curated list. */
export function suggestionUrl(b) {
  const title = `Add brand: ${b.name} (${b.owner}, ${b.country})`;
  const body = [
    `**Brand:** ${b.name}`,
    `**Owner:** ${b.owner} (${b.country})`,
    b.chain?.length > 1 ? `**Ownership chain:** ${b.chain.join(' → ')}` : null,
    b.wikidataUrl ? `**Source:** ${b.wikidataUrl}` : null,
    '',
    'Suggested line for `js/brands.js` (please check the category and owner):',
    '```js',
    toBrandsJsLine(b),
    '```',
    '',
    '_Sent from the Swadeshi Scanner app._',
  ].filter((l) => l !== null).join('\n');
  return `https://github.com/${REPO}/issues/new?${new URLSearchParams({ title, body, labels: 'brand-suggestion' })}`;
}
