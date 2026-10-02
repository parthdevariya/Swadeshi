// Extracts origin signals from free text — OCR output from a product label,
// or text fields returned by an online product database.

import { BRANDS, AMBIGUOUS_NAMES } from './brands.js';

const COUNTRIES = [
  'india', 'china', 'united states', 'usa', 'u.s.a', 'united kingdom', 'uk', 'england', 'germany', 'france',
  'italy', 'spain', 'japan', 'south korea', 'korea', 'taiwan', 'vietnam', 'thailand', 'malaysia',
  'indonesia', 'singapore', 'bangladesh', 'sri lanka', 'nepal', 'pakistan', 'philippines', 'turkey',
  'switzerland', 'netherlands', 'belgium', 'poland', 'mexico', 'brazil', 'canada', 'australia',
  'new zealand', 'uae', 'united arab emirates', 'saudi arabia', 'hong kong', 'prc', 'ireland',
  'denmark', 'sweden', 'norway', 'austria', 'czech republic', 'egypt', 'south africa',
];

const COUNTRY_ALIASES = {
  usa: 'United States', 'u.s.a': 'United States', 'united states': 'United States',
  uk: 'United Kingdom', england: 'United Kingdom', 'united kingdom': 'United Kingdom',
  korea: 'South Korea', prc: 'China', uae: 'United Arab Emirates',
};

const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat', 'haryana',
  'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh', 'maharashtra', 'manipur',
  'meghalaya', 'mizoram', 'nagaland', 'odisha', 'orissa', 'punjab', 'rajasthan', 'sikkim', 'tamil nadu',
  'telangana', 'tripura', 'uttar pradesh', 'uttarakhand', 'west bengal', 'new delhi', 'delhi',
  'jammu', 'puducherry', 'chandigarh', 'mumbai', 'kolkata', 'chennai', 'bengaluru', 'bangalore',
  'hyderabad', 'ahmedabad', 'pune',
];

function titleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

function canonicalCountry(raw) {
  const k = raw.toLowerCase().trim();
  return COUNTRY_ALIASES[k] || titleCase(k);
}

/**
 * Normalise text for matching: lower-case, strip accents, collapse whitespace,
 * and repair the most common OCR confusions in the word "india".
 */
export function normalizeText(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b[i1l|!]nd[i1l|!]a\b/g, 'india')
    .replace(/\s+/g, ' ')
    .trim();
}

const COUNTRY_PATTERN = COUNTRIES.map((c) => c.replace(/\./g, '\\.')).sort((a, b) => b.length - a.length).join('|');

/** Find explicit country-of-origin statements, e.g. "Made in India", "Country of Origin: China". */
export function findOriginCountries(text) {
  const t = normalizeText(text);
  const found = [];
  const patterns = [
    new RegExp(`country\\s*of\\s*origin\\s*[:\\-–.]?\\s*(${COUNTRY_PATTERN})\\b`, 'g'),
    new RegExp(`\\bmade\\s*in\\s*[:\\-]?\\s*(${COUNTRY_PATTERN})\\b`, 'g'),
    new RegExp(`\\bproduct\\s*of\\s*[:\\-]?\\s*(${COUNTRY_PATTERN})\\b`, 'g'),
    new RegExp(`\\borigin\\s*[:\\-]\\s*(${COUNTRY_PATTERN})\\b`, 'g'),
  ];
  for (const re of patterns) {
    for (const m of t.matchAll(re)) found.push(canonicalCountry(m[1]));
  }
  return [...new Set(found)];
}

/** "Imported by" / "Importer" / "Imported & marketed by" lines. */
export function hasImporterStatement(text) {
  return /\bimport(ed|er)\b/.test(normalizeText(text));
}

/** "Manufactured by …, <Indian state or city>" — product made in India. */
export function hasIndianManufacturer(text) {
  const t = normalizeText(text);
  const re = /\b(manufactured|mfd|mfg|packed|produced)\.?\s*(and\s*packed\s*)?(by|at)\b([^]{0,160})/g;
  for (const m of t.matchAll(re)) {
    // Only look at the manufacturer's own address, not a marketer/importer that follows it.
    const tail = m[4].split(/\b(marketed|imported|importer|distributed|customer care|consumer care)\b/)[0];
    if (/\bindia\b/.test(tail) || INDIAN_STATES.some((s) => tail.includes(s))) return true;
  }
  return false;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BRAND_MATCHERS = BRANDS.map((b) => {
  const n = normalizeText(b.name);
  return { brand: b, key: n, re: new RegExp(`(^|[^a-z0-9])${escapeRe(n)}($|[^a-z0-9])`) };
}).sort((a, b) => b.key.length - a.key.length);

/**
 * Find known brands mentioned in text.
 * `structured: true` means the text is a brand field (e.g. from a product
 * database), so even ambiguous everyday words are trusted.
 */
export function findBrands(text, { structured = false } = {}) {
  let t = normalizeText(text);
  if (!t) return [];
  const hits = [];
  for (const m of BRAND_MATCHERS) {
    if (!structured && AMBIGUOUS_NAMES.has(m.key)) continue;
    if (m.re.test(t)) {
      hits.push(m.brand);
      // Blank out the match so "Maruti Suzuki" doesn't also match "Suzuki".
      t = t.replace(m.re, '$1 $2');
    }
  }
  return hits;
}

/** Pull every origin signal out of a block of text. */
export function parseLabelText(text) {
  return {
    originCountries: findOriginCountries(text),
    imported: hasImporterStatement(text),
    indianManufacturer: hasIndianManufacturer(text),
    brands: findBrands(text),
  };
}
