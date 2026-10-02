// Combines all signals into a single, explainable verdict.
//
// Two separate questions decide whether a product is "Swadeshi":
//   1. Ownership — is the brand owned by an Indian company?  (where profits go)
//   2. Manufacture — was this unit made in India?            (where jobs are)
// We answer each independently and then combine them.

import { BRANDS, CATEGORY_LABELS, RELATED_CATEGORIES } from './brands.js';
import { analyzeBarcode } from './barcode.js';
import { findBrands, findOriginCountries, hasImporterStatement, hasIndianManufacturer } from './textParser.js';

export const VERDICTS = {
  swadeshi: {
    label: 'Swadeshi',
    emoji: '🇮🇳',
    summary: 'Indian-owned brand, made in India.',
  },
  'indian-brand': {
    label: 'Indian brand',
    emoji: '🟢',
    summary: 'Owned by an Indian company. Check the pack for where this unit was made.',
  },
  'indian-brand-imported': {
    label: 'Indian brand, made abroad',
    emoji: '🟡',
    summary: 'The brand is Indian, but this product appears to be manufactured outside India.',
  },
  'made-in-india': {
    label: 'Made in India, foreign-owned',
    emoji: '🟠',
    summary: 'Manufactured in India (local jobs), but the brand is owned by a foreign company.',
  },
  'likely-indian': {
    label: 'Likely Indian',
    emoji: '🟢',
    summary: 'Signals point to India, but the brand owner could not be confirmed.',
  },
  foreign: {
    label: 'Foreign',
    emoji: '🔴',
    summary: 'Foreign-owned brand and not shown as made in India.',
  },
  'foreign-brand': {
    label: 'Foreign brand',
    emoji: '🔴',
    summary: 'Owned by a foreign company. Check the pack for where this unit was made.',
  },
  'likely-foreign': {
    label: 'Likely foreign',
    emoji: '🟠',
    summary: 'Signals point outside India, but the brand owner could not be confirmed.',
  },
  unknown: {
    label: 'Not enough information',
    emoji: '❔',
    summary: 'Try scanning the label text (look for "Country of Origin" or "Manufactured by").',
  },
};

/**
 * @param {object} input
 * @param {string} [input.barcode]       Scanned barcode digits.
 * @param {string} [input.labelText]     OCR text from the pack.
 * @param {string} [input.brandQuery]    Brand typed by the user.
 * @param {string} [input.headline]      Largest text on the pack (usually the brand), from OCR.
 * @param {object} [input.online]        Normalised online lookup result (see lookup.js).
 * @param {object} [input.web]           Wikidata ownership research (see webLookup.js).
 */
export function classify(input = {}) {
  const evidence = [];
  const add = (direction, weight, text) => evidence.push({ direction, weight, text });

  // ---- Brand identification -------------------------------------------------
  let brand = null;
  const tryBrands = (text, opts, source) => {
    if (brand || !text) return;
    const hits = findBrands(text, opts);
    if (hits.length) brand = { ...hits[0], source };
  };
  tryBrands(input.brandQuery, { structured: true }, 'your search');
  tryBrands(input.headline, { structured: true }, 'label');
  tryBrands(input.online?.brands, { structured: true }, 'product database');
  tryBrands(input.online?.brandOwner, { structured: true }, 'product database');
  tryBrands(input.online?.productName, {}, 'product name');
  tryBrands(input.labelText, {}, 'label text');

  let ownership = null; // 'indian' | 'foreign' | null
  if (brand) {
    ownership = brand.indian ? 'indian' : 'foreign';
    if (brand.learned) {
      const when = brand.addedAt ? ` on ${new Date(brand.addedAt).toLocaleDateString()}` : '';
      const who = brand.owner === brand.name
        ? `${brand.name} is a company based in ${brand.country}`
        : `${brand.name} is owned by ${brand.owner} (${brand.country})`;
      add(ownership === 'indian' ? 'india' : 'foreign', 2, `${who} — saved from Wikidata${when}.`);
    } else {
      add(ownership === 'indian' ? 'india' : 'foreign', 3,
        `${brand.name} is owned by ${brand.owner} (${brand.country}).`);
    }
    if (brand.note) add('info', 0, brand.note);
  } else if (input.web?.ownerCountry) {
    // Not in our curated list — fall back to what Wikidata says.
    const w = input.web;
    const indian = w.ownerCountry === 'India';
    brand = { name: w.name, owner: w.owner, country: w.ownerCountry, indian, category: null, note: null, source: 'web' };
    ownership = indian ? 'indian' : 'foreign';
    add(indian ? 'india' : 'foreign', 2, w.chain.length > 1
      ? `Wikidata: ${w.name} is owned by ${w.owner}, based in ${w.ownerCountry} (${w.chain.join(' → ')}).`
      : `Wikidata: ${w.name} is a company based in ${w.ownerCountry}.`);
  }

  // ---- Manufacture ----------------------------------------------------------
  let manufacture = null; // 'india' | 'abroad' | null
  const texts = [input.labelText, input.online?.origins, input.online?.manufacturingPlaces].filter(Boolean).join('\n');
  const origins = findOriginCountries(texts);
  const onlinePlaces = (input.online?.manufacturingPlaces || '') + ' ' + (input.online?.origins || '');
  if (origins.includes('India')) {
    manufacture = 'india';
    add('india', 3, 'Label says it is made in / originates from India.');
  } else if (origins.length) {
    manufacture = 'abroad';
    add('foreign', 3, `Label says country of origin: ${origins.join(', ')}.`);
  } else if (/\bindia\b/i.test(onlinePlaces)) {
    manufacture = 'india';
    add('india', 2, 'Product database lists India as manufacturing place / origin.');
  } else if (input.labelText && hasIndianManufacturer(input.labelText)) {
    manufacture = 'india';
    add('india', 2, 'Label lists a manufacturer with an Indian address.');
  }

  if (input.labelText && hasImporterStatement(input.labelText) && manufacture !== 'india') {
    if (!manufacture) manufacture = 'abroad';
    add('foreign', 2, 'Label mentions an importer — the product was likely made abroad.');
  }

  // ---- Barcode --------------------------------------------------------------
  let barcode = null;
  if (input.barcode) {
    barcode = analyzeBarcode(input.barcode);
    if (!barcode.valid) {
      add('info', 0, `Barcode ${barcode.code} failed its check-digit test — it may have been mis-read.`);
    } else if (barcode.isIndianPrefix) {
      add('india', 1, 'Barcode starts with 890 — the company registered it with GS1 India.');
    } else if (barcode.gs1Country) {
      add('foreign', 1, `Barcode prefix is registered in ${barcode.gs1Country} (shows where the code was issued, not necessarily where it was made).`);
    }
  }

  if (input.online?.countries && /\bindia\b/i.test(input.online.countries) && !manufacture) {
    add('info', 0, 'Sold in India according to the product database.');
  }

  // ---- Verdict --------------------------------------------------------------
  let verdict;
  if (ownership === 'indian') {
    verdict = manufacture === 'india' ? 'swadeshi' : manufacture === 'abroad' ? 'indian-brand-imported' : 'indian-brand';
  } else if (ownership === 'foreign') {
    verdict = manufacture === 'india' ? 'made-in-india' : manufacture === 'abroad' ? 'foreign' : 'foreign-brand';
  } else {
    const score = evidence.reduce((s, e) => s + (e.direction === 'india' ? e.weight : e.direction === 'foreign' ? -e.weight : 0), 0);
    if (manufacture === 'india' || score >= 2) verdict = 'likely-indian';
    else if (manufacture === 'abroad' || score <= -2) verdict = 'likely-foreign';
    else if (score === 1) verdict = 'likely-indian';
    else if (score === -1) verdict = 'likely-foreign';
    else verdict = 'unknown';
  }

  const strength = evidence.reduce((s, e) => s + (e.direction === 'info' ? 0 : e.weight), 0);
  const confidence = strength >= 6 ? 'high' : strength >= 3 ? 'medium' : strength > 0 ? 'low' : 'none';

  return {
    verdict,
    ...VERDICTS[verdict],
    confidence,
    brand,
    ownership,
    manufacture,
    barcode,
    evidence,
    alternatives: ownership === 'indian' ? [] : suggestAlternatives(brand?.category ?? guessCategory(input.online?.categories)),
  };
}

/** Map free text (product categories, a company description) to one of our categories. */
export function guessCategory(text) {
  const cat = String(text || '').toLowerCase();
  const map = [
    [/biscuit|cookie/, 'biscuits'], [/chocolate|confection|candy/, 'chocolates'], [/chip|snack|namkeen/, 'snacks'],
    [/noodle|pasta|ketchup|sauce|cereal/, 'packaged-food'], [/\btea\b|coffee/, 'tea-coffee'], [/water/, 'water'],
    [/beverage|drink|juice|soda/, 'beverages'], [/milk|dairy|cheese|yogurt|ice cream|butter|ghee/, 'dairy'],
    [/spice|masala/, 'spices'], [/shampoo|soap|cosmetic|toothpaste|cream|hair|personal care/, 'personal-care'],
    [/detergent|clean/, 'home-care'], [/electronic|smartphone|audio|headphone/, 'electronics'],
    [/appliance/, 'appliances'], [/footwear|shoe/, 'footwear'], [/apparel|clothing|fashion/, 'apparel'],
    [/automo|motorcycle|scooter|vehicle/, 'automobiles'], [/paint/, 'paints'], [/food/, 'packaged-food'],
  ];
  return map.find(([re]) => re.test(cat))?.[1] ?? null;
}

/** Indian-owned brands in the same (or a related) category. */
export function suggestAlternatives(category, limit = 6) {
  if (!category) return [];
  const cats = [category, ...(RELATED_CATEGORIES[category] || [])];
  const seenOwners = new Set();
  const out = [];
  for (const c of cats) {
    for (const b of BRANDS) {
      if (!b.indian || b.category !== c || seenOwners.has(b.owner)) continue;
      seenOwners.add(b.owner); // one flagship brand per company keeps the list varied
      out.push({ name: b.name, owner: b.owner, category: CATEGORY_LABELS[b.category] || b.category });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
