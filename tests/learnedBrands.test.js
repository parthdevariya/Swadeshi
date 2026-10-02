import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeLearnedEntry, learnBrand, loadLearned, forgetBrand, toBrandsJsLine, suggestionUrl } from '../js/learnedBrands.js';
import { setLearnedBrands, findBrands } from '../js/textParser.js';
import { classify } from '../js/classifier.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

const web = { name: 'Sunrise Snacks', owner: 'Sunrise Snacks', ownerCountry: 'India', chain: ['Sunrise Snacks'], query: 'Sunrise Snacks Pvt. Ltd.', wikidataUrl: 'https://www.wikidata.org/wiki/Q5001', description: 'Indian snack food company' };

let store;
beforeEach(() => {
  store = memoryStorage();
  setLearnedBrands([]);
});

test('builds an entry with useful aliases only', () => {
  const e = makeLearnedEntry(web, { aliases: ['PEPPY CRUNCH', 'Real', '12'], category: 'snacks', now: 1 });
  assert.equal(e.indian, true);
  assert.deepEqual(e.aliases, ['PEPPY CRUNCH']); // query cleans to the name; "Real" is ambiguous; "12" isn't a name
  assert.equal(e.learned, true);
});

test('saves, merges and forgets learned brands', () => {
  learnBrand(makeLearnedEntry(web, { aliases: ['Peppy Crunch'], now: 1 }), store);
  learnBrand(makeLearnedEntry(web, { aliases: ['Masala Twists'], now: 2 }), store);
  const list = loadLearned(store);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].aliases.sort(), ['Masala Twists', 'Peppy Crunch']);
  assert.equal(list[0].addedAt, 1); // keeps the original date
  assert.deepEqual(forgetBrand('sunrise snacks', store), []);
});

test('survives broken or missing storage', () => {
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
  assert.deepEqual(loadLearned(broken), []);
  assert.doesNotThrow(() => learnBrand(makeLearnedEntry(web), broken));
});

test('learned brands are matched on the next scan, offline', () => {
  setLearnedBrands([makeLearnedEntry(web, { aliases: ['Peppy Crunch'], category: 'snacks', now: 1 })]);
  const r = classify({ headline: 'PEPPY CRUNCH', labelText: 'Country of Origin: India' });
  assert.equal(r.verdict, 'swadeshi');
  assert.equal(r.brand.learned, true);
  assert.ok(r.evidence.some((e) => /saved from Wikidata/.test(e.text)));
});

test('curated list always wins over a learned entry with the same name', () => {
  setLearnedBrands([{ ...makeLearnedEntry({ ...web, name: 'Amul', ownerCountry: 'France' }) }]);
  assert.equal(findBrands('Amul', { structured: true })[0].indian, true);
  assert.equal(findBrands('Amul', { structured: true }).length, 1);
});

test('produces a ready-to-paste brands.js line and a GitHub issue link', () => {
  const e = makeLearnedEntry(web, { aliases: ["Peppy's Crunch"], category: 'snacks' });
  assert.equal(toBrandsJsLine(e), "I('Sunrise Snacks', 'snacks', ['Sunrise Snacks', 'Peppy\\'s Crunch']),");
  const f = makeLearnedEntry({ ...web, owner: 'Global Foods', ownerCountry: 'Germany' }, { category: 'snacks' });
  assert.match(toBrandsJsLine(f), /^F\('Global Foods', 'Germany', 'snacks'/);
  const url = new URL(suggestionUrl(e));
  assert.equal(url.pathname, '/parthdevariya/Swadeshi/issues/new');
  assert.match(url.searchParams.get('body'), /I\('Sunrise Snacks'/);
});
