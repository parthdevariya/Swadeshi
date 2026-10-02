// Free, key-less web research on a brand or company name.
//
//   • Wikidata  — structured "owned by" / "parent organization" chain, so we can
//                 find the ultimate owner and its country.
//   • Wikipedia — a short human-readable summary and photo.
//
// Both APIs are free, need no account, and allow browser (CORS) requests.

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const WIKIPEDIA_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const P = {
  instanceOf: 'P31',
  ownedBy: 'P127',
  parentOrg: 'P749',
  manufacturer: 'P176',
  country: 'P17',
  headquarters: 'P159',
  countryOfOrigin: 'P495',
  citizenship: 'P27',
  endTime: 'P582',
};

const GOOD_DESC = /brand|company|multinational|group|holding|industr|manufactur|conglomerate|corporation|co-?operative|business|enterprise|subsidiary|producer|maker|food|beverage|drink|snack|dairy|cosmetic|consumer|appliance|automo|electronic|retail|apparel|footwear|fmcg|tea|coffee|soft drink|confection|biscuit|spice|pharma/i;
const BAD_DESC = /human|person|actor|actress|politician|film|album|song|single by|novel|village|city|town|river|mountain|given name|family name|surname|disambiguation|asteroid|species|genus|episode|television series/i;

async function getJson(fetchFn, url, timeoutMs = 8000) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

function wd(params) {
  const q = new URLSearchParams({ format: 'json', origin: '*', ...params });
  return `${WIKIDATA}?${q}`;
}

/** Strip legal suffixes so "Parle Products Pvt. Ltd." searches as "Parle Products". */
export function cleanCompanyName(name) {
  return String(name)
    .replace(/\b(private|pvt\.?|pvt)\s*(limited|ltd\.?)\b/gi, '')
    .replace(/\b(limited|ltd\.?|llp|inc\.?|incorporated|corporation|corp\.?|co\.|plc|gmbh|s\.a\.|ag)\s*$/gi, '')
    .replace(/[.,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Claims that are still current (no end date), preferred-rank first. */
function activeTargets(entity, prop) {
  const claims = entity?.claims?.[prop] || [];
  const live = claims.filter((c) => c.rank !== 'deprecated' && !c.qualifiers?.[P.endTime] && c.mainsnak?.datavalue?.value?.id);
  const preferred = live.filter((c) => c.rank === 'preferred');
  return (preferred.length ? preferred : live).map((c) => c.mainsnak.datavalue.value.id);
}

const label = (e) => e?.labels?.en?.value || e?.id || '';

async function getEntities(fetchFn, ids) {
  if (!ids.length) return {};
  const data = await getJson(fetchFn, wd({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|claims|sitelinks', languages: 'en', sitefilter: 'enwiki' }));
  return data?.entities || {};
}

/** Pick the search hit that looks like a brand/company rather than a person or place. */
export function pickCandidate(hits) {
  const usable = (hits || []).filter((h) => !BAD_DESC.test(h.description || ''));
  return usable.find((h) => GOOD_DESC.test(h.description || '')) || null;
}

/**
 * The next owner up the chain. Parent organisation is preferred: "owned by"
 * on listed companies often lists institutional shareholders, so we only
 * follow it when it names a single current owner.
 */
function nextOwnerId(entity) {
  const parent = activeTargets(entity, P.parentOrg);
  if (parent.length) return parent[0];
  const owners = activeTargets(entity, P.ownedBy);
  if (owners.length === 1) return owners[0];
  const maker = activeTargets(entity, P.manufacturer);
  if (maker.length === 1) return maker[0];
  return null;
}

async function countryOf(fetchFn, entity) {
  let id = activeTargets(entity, P.country)[0] || activeTargets(entity, P.citizenship)[0];
  if (!id) {
    const hq = activeTargets(entity, P.headquarters)[0];
    if (hq) id = activeTargets((await getEntities(fetchFn, [hq]))[hq], P.country)[0];
  }
  id ||= activeTargets(entity, P.countryOfOrigin)[0];
  if (!id) return null;
  return label((await getEntities(fetchFn, [id]))[id]) || null;
}

/**
 * Research a brand/company name on Wikidata. Resolves to
 * { name, description, owner, ownerCountry, chain[], wikidataUrl, wikipediaTitle } or null.
 */
export async function researchOwnership(name, { fetchFn = globalThis.fetch } = {}) {
  const query = cleanCompanyName(name);
  if (query.length < 2) return null;
  const search = await getJson(fetchFn, wd({ action: 'wbsearchentities', search: query, language: 'en', uselang: 'en', type: 'item', limit: '8' }));
  const hit = pickCandidate(search?.search);
  if (!hit) return null;

  let entity = (await getEntities(fetchFn, [hit.id]))[hit.id];
  if (!entity) return null;
  const start = entity;
  const chain = [label(entity)];
  const seen = new Set([entity.id]);
  for (let hop = 0; hop < 5; hop++) {
    const next = nextOwnerId(entity);
    if (!next || seen.has(next)) break;
    const e = (await getEntities(fetchFn, [next]))[next];
    if (!e) break;
    // Stop at people/families — the company they own is the meaningful owner.
    if (activeTargets(e, P.instanceOf).includes('Q5')) break;
    seen.add(next);
    chain.push(label(e));
    entity = e;
  }

  return {
    name: label(start),
    description: start.descriptions?.en?.value || hit.description || '',
    owner: label(entity),
    ownerCountry: await countryOf(fetchFn, entity),
    chain,
    wikidataUrl: `https://www.wikidata.org/wiki/${start.id}`,
    wikipediaTitle: start.sitelinks?.enwiki?.title || null,
  };
}

/**
 * Short Wikipedia summary for display. With `requireBusiness`, articles that
 * aren't about a brand or company are rejected — "Britannia" the national
 * personification is not "Britannia" the biscuit maker.
 */
export async function wikipediaSummary(title, { fetchFn = globalThis.fetch, requireBusiness = false } = {}) {
  if (!title) return null;
  const data = await getJson(fetchFn, WIKIPEDIA_SUMMARY + encodeURIComponent(title.replace(/ /g, '_')));
  if (!data?.extract || data.type === 'disambiguation') return null;
  if (requireBusiness) {
    const about = `${data.description || ''} ${data.extract.slice(0, 300)}`;
    if (!GOOD_DESC.test(about) || BAD_DESC.test(data.description || '')) return null;
  }
  return {
    title: data.title,
    extract: data.extract,
    image: data.thumbnail?.source || null,
    url: data.content_urls?.mobile?.page || data.content_urls?.desktop?.page || null,
  };
}

/** Background on a brand: exact Wikipedia title from Wikidata, else the brand, else its owner. */
export async function brandBackground({ wikipediaTitle, brand, owner }, opts = {}) {
  if (wikipediaTitle) {
    const w = await wikipediaSummary(wikipediaTitle, opts);
    if (w) return w;
  }
  const titles = [brand, brand && `${brand} (brand)`, owner && owner.replace(/\s*\(.*\)$/, '')];
  for (const t of [...new Set(titles.filter(Boolean))]) {
    const w = await wikipediaSummary(t, { ...opts, requireBusiness: true });
    if (w) return w;
  }
  return null;
}

/** Try each candidate name in order until one resolves. */
export async function researchFirst(candidates, opts) {
  const tried = new Set();
  for (const c of candidates) {
    const key = cleanCompanyName(c).toLowerCase();
    if (!key || tried.has(key)) continue;
    tried.add(key);
    const r = await researchOwnership(c, opts);
    if (r) return { ...r, query: c };
  }
  return null;
}

/** A plain web search link as the last-resort, always-free fallback. */
export function webSearchUrl(name) {
  return `https://duckduckgo.com/?q=${encodeURIComponent(`${name} brand owner company country`)}`;
}
