import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, suggestAlternatives } from '../js/classifier.js';
import { BRANDS } from '../js/brands.js';

test('Indian brand + made in India → swadeshi', () => {
  const r = classify({ brandQuery: 'Amul', labelText: 'Country of Origin: India' });
  assert.equal(r.verdict, 'swadeshi');
  assert.equal(r.confidence, 'high');
  assert.deepEqual(r.alternatives, []);
});

test('Indian brand alone → indian-brand', () => {
  assert.equal(classify({ brandQuery: 'Parle-G' }).verdict, 'indian-brand');
});

test('Indian brand made abroad', () => {
  assert.equal(classify({ brandQuery: 'boAt', labelText: 'Made in China' }).verdict, 'indian-brand-imported');
});

test('foreign brand made in India', () => {
  const r = classify({ brandQuery: 'Maggi', labelText: 'Mfd by Nestle India Ltd, Moga, Punjab' });
  assert.equal(r.verdict, 'made-in-india');
  assert.ok(r.alternatives.length > 0);
  assert.ok(r.alternatives.every((a) => BRANDS.find((b) => b.name === a.name).indian));
});

test('heritage brands sold abroad are reported as foreign-owned', () => {
  const r = classify({ brandQuery: 'Thums Up' });
  assert.equal(r.verdict, 'foreign-brand');
  assert.ok(r.evidence.some((e) => /Parle/.test(e.text)));
});

test('brand found via online product data', () => {
  const r = classify({
    barcode: '8901063010031',
    online: { productName: 'Good Day Cashew', brands: 'Britannia', manufacturingPlaces: 'India', origins: '', countries: 'India' },
  });
  assert.equal(r.verdict, 'swadeshi');
  assert.equal(r.brand.name, 'Britannia');
});

test('barcode only, Indian prefix → likely-indian with low confidence', () => {
  const r = classify({ barcode: '8901063010031' });
  assert.equal(r.verdict, 'likely-indian');
  assert.equal(r.confidence, 'low');
});

test('barcode only, Chinese prefix + label import → likely-foreign', () => {
  const r = classify({ barcode: '6901234567892', labelText: 'Imported by XYZ' });
  assert.equal(r.verdict, 'likely-foreign');
});

test('nothing known → unknown', () => {
  assert.equal(classify({}).verdict, 'unknown');
});

test('classify does not mutate the shared brand database', () => {
  classify({ brandQuery: 'Amul' });
  assert.equal('source' in BRANDS.find((b) => b.name === 'Amul'), false);
});

test('alternatives list one brand per company', () => {
  const alts = suggestAlternatives('personal-care', 20);
  assert.equal(new Set(alts.map((a) => a.owner)).size, alts.length);
});

test('brand database has no conflicting duplicate names', () => {
  const seen = new Map();
  for (const b of BRANDS) {
    const k = b.name.toLowerCase();
    if (seen.has(k)) assert.equal(seen.get(k), b.indian, `conflicting ownership for ${b.name}`);
    seen.set(k, b.indian);
  }
});

test('unknown brand uses Wikidata ownership', () => {
  const web = { name: 'Some Cola', owner: 'Global Drinks Inc', ownerCountry: 'United States', chain: ['Some Cola', 'Global Drinks Inc'] };
  const r = classify({ headline: 'Some Cola', web, labelText: 'Made in India' });
  assert.equal(r.verdict, 'made-in-india');
  assert.ok(r.evidence.some((e) => e.text.startsWith('Wikidata:')));
});

test('curated list wins over Wikidata', () => {
  const web = { name: 'Amul', owner: 'Somebody', ownerCountry: 'France', chain: ['Amul'] };
  assert.equal(classify({ brandQuery: 'Amul', web }).ownership, 'indian');
});

test('large headline text identifies the brand', () => {
  assert.equal(classify({ headline: 'Real' }).brand.owner, 'Dabur India');
});
