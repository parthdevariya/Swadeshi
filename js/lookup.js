// Online product lookup via the open, CORS-enabled Open Food Facts family of
// databases (food, cosmetics, general products). Returns a normalised record.

const SOURCES = [
  { name: 'Open Food Facts', base: 'https://world.openfoodfacts.org' },
  { name: 'Open Beauty Facts', base: 'https://world.openbeautyfacts.org' },
  { name: 'Open Products Facts', base: 'https://world.openproductsfacts.org' },
];

const FIELDS = [
  'product_name', 'product_name_en', 'brands', 'brand_owner', 'manufacturing_places', 'origins',
  'countries', 'categories', 'image_front_small_url',
].join(',');

export function normalizeProduct(p, sourceName) {
  if (!p) return null;
  return {
    source: sourceName,
    productName: p.product_name || p.product_name_en || '',
    brands: p.brands || '',
    brandOwner: p.brand_owner || '',
    manufacturingPlaces: p.manufacturing_places || '',
    origins: p.origins || '',
    countries: p.countries || '',
    categories: p.categories || '',
    image: p.image_front_small_url || '',
  };
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function lookupIn(src, code, timeoutMs) {
  try {
    const res = await fetchWithTimeout(`${src.base}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, timeoutMs);
    if (!res.ok) return null;
    const data = await res.json();
    return data.status === 1 && data.product ? normalizeProduct(data.product, src.name) : null;
  } catch {
    return null; // Offline or timed out — fall back to local analysis.
  }
}

/** Look a barcode up across all sources in parallel; resolves to null when not found or offline. */
export async function lookupBarcode(code, { timeoutMs = 8000 } = {}) {
  const results = await Promise.all(SOURCES.map((src) => lookupIn(src, code, timeoutMs)));
  return results.find(Boolean) ?? null;
}
