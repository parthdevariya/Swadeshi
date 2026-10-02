import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCompanyName, pickCandidate, researchOwnership, researchFirst, wikipediaSummary } from '../js/webLookup.js';

// --- A tiny fake Wikidata, shaped like the real API responses ---------------
const item = (id) => ({ mainsnak: { snaktype: 'value', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id } } }, rank: 'normal' });
const ENTITIES = {
  Q1: { id: 'Q1', labels: { en: { value: 'Maggi' } }, descriptions: { en: { value: 'brand of instant noodles' } }, claims: { P127: [item('Q2')] }, sitelinks: { enwiki: { title: 'Maggi' } } },
  Q2: { id: 'Q2', labels: { en: { value: 'Nestlé' } }, claims: { P17: [item('Q39')], P127: [item('Q90'), item('Q91')] } },
  Q39: { id: 'Q39', labels: { en: { value: 'Switzerland' } }, claims: {} },
  Q10: { id: 'Q10', labels: { en: { value: 'Parle Products' } }, descriptions: { en: { value: 'Indian food company' } }, claims: { P159: [item('Q20')] } },
  Q20: { id: 'Q20', labels: { en: { value: 'Mumbai' } }, claims: { P17: [item('Q668')] } },
  Q668: { id: 'Q668', labels: { en: { value: 'India' } }, claims: {} },
  // Ownership ended (has end-time qualifier) → must be ignored.
  Q30: { id: 'Q30', labels: { en: { value: 'Thums Up' } }, descriptions: { en: { value: 'cola brand' } }, claims: { P127: [{ ...item('Q10'), qualifiers: { P582: [{}] } }, item('Q31')] } },
  Q31: { id: 'Q31', labels: { en: { value: 'The Coca-Cola Company' } }, claims: { P17: [item('Q30US')] } },
  Q30US: { id: 'Q30US', labels: { en: { value: 'United States' } }, claims: {} },
};
const SEARCH = {
  maggi: [{ id: 'Q99', description: 'given name' }, { id: 'Q1', description: 'brand of instant noodles' }],
  'parle products': [{ id: 'Q10', description: 'Indian food company' }],
  'thums up': [{ id: 'Q30', description: 'cola brand' }],
};

function fakeFetch(url) {
  const u = new URL(url);
  let body;
  if (u.hostname === 'www.wikidata.org') {
    const p = u.searchParams;
    assert.equal(p.get('origin'), '*', 'CORS origin param must be set');
    if (p.get('action') === 'wbsearchentities') body = { search: SEARCH[p.get('search').toLowerCase()] || [] };
    else body = { entities: Object.fromEntries(p.get('ids').split('|').map((id) => [id, ENTITIES[id]])) };
  } else if (u.hostname === 'en.wikipedia.org') {
    body = u.pathname.endsWith('/Maggi')
      ? { title: 'Maggi', extract: 'Maggi is an international brand of seasonings and instant noodles.', thumbnail: { source: 'x.png' }, content_urls: { mobile: { page: 'https://en.m.wikipedia.org/wiki/Maggi' } } }
      : {};
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}
const opts = { fetchFn: fakeFetch };

test('cleans legal suffixes from company names', () => {
  assert.equal(cleanCompanyName('Parle Products Pvt. Ltd.'), 'Parle Products');
  assert.equal(cleanCompanyName('Nestle India Limited'), 'Nestle India');
  assert.equal(cleanCompanyName('Hindustan Unilever Ltd'), 'Hindustan Unilever');
});

test('skips people and places when picking a search hit', () => {
  assert.equal(pickCandidate([{ id: 'A', description: 'Indian actor' }, { id: 'B', description: 'Indian dairy brand' }]).id, 'B');
  assert.equal(pickCandidate([{ id: 'A', description: 'village in Punjab' }]), null);
});

test('follows ownership to the parent company and its country', async () => {
  const r = await researchOwnership('Maggi', opts);
  assert.equal(r.owner, 'Nestlé');
  assert.equal(r.ownerCountry, 'Switzerland');
  assert.deepEqual(r.chain, ['Maggi', 'Nestlé']);
  assert.equal(r.wikipediaTitle, 'Maggi');
});

test('does not follow "owned by" when it lists several shareholders', async () => {
  const r = await researchOwnership('Maggi', opts);
  assert.equal(r.chain.length, 2); // stopped at Nestlé despite its two P127 values
});

test('resolves country through the headquarters location', async () => {
  const r = await researchOwnership('Parle Products Pvt. Ltd.', opts);
  assert.equal(r.ownerCountry, 'India');
});

test('ignores ownership claims that have ended', async () => {
  const r = await researchOwnership('Thums Up', opts);
  assert.equal(r.owner, 'The Coca-Cola Company');
  assert.equal(r.ownerCountry, 'United States');
});

test('researchFirst falls through unknown names', async () => {
  const r = await researchFirst(['Unknown Brand XYZ', 'Parle Products Ltd'], opts);
  assert.equal(r.name, 'Parle Products');
  assert.equal(r.query, 'Parle Products Ltd');
});

test('returns null when offline', async () => {
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  assert.equal(await researchOwnership('Maggi', { fetchFn: offline }), null);
});

test('fetches a Wikipedia summary', async () => {
  const w = await wikipediaSummary('Maggi', opts);
  assert.match(w.extract, /instant noodles/);
  assert.equal(await wikipediaSummary('Nothing Here', opts), null);
});

test('brand background skips non-business articles and falls back to the owner', async () => {
  const pages = {
    Britannia: { title: 'Britannia', description: 'national personification of Great Britain', extract: 'Britannia is the national personification of Britain.' },
    'Britannia_Industries': { title: 'Britannia Industries', description: 'Indian food company', extract: 'Britannia Industries is an Indian food company.' },
  };
  const fetchFn = (url) => {
    const key = decodeURIComponent(url.split('/summary/')[1]);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(pages[key] || {}) });
  };
  const { brandBackground } = await import('../js/webLookup.js');
  const w = await brandBackground({ brand: 'Britannia', owner: 'Britannia Industries (Wadia Group)' }, { fetchFn });
  assert.equal(w.title, 'Britannia Industries');
});
