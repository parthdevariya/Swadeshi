// Image understanding with the user's own (free-tier) Google API key.
//
//   • Gemini (Google AI Studio) — a multimodal model looks at the whole photo
//     (logo, design, text) and returns product, brand and maker as JSON.
//     Free tier, no credit card.
//   • Google Cloud Vision — the technology behind Google Lens: logo detection,
//     web detection (visually similar products / best-guess label) and OCR.
//     1,000 units per feature per month free; needs a billing account.
//
// Keys live only in this browser and are sent only to Google. Everything here
// is pure apart from fetch, which is injectable for tests.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';
export const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';

const PROMPT = `You help Indian shoppers find out who makes a product. Look at the photo: packaging, logo, colours, design and any printed text.
Return JSON with:
- productName: the product as a shopper would name it (e.g. "Maggi 2-Minute Masala Noodles"), or null.
- brand: the brand visible on the product (e.g. "Maggi"). Only a brand you can actually see or clearly recognise; otherwise null.
- manufacturer: company printed after "Manufactured by"/"Mfd. by"/"Marketed by", if readable, else null.
- brandOwner: the company that ultimately owns this brand today, from your knowledge (e.g. "Nestlé"), or null if unsure.
- ownerCountry: country where brandOwner is headquartered (e.g. "Switzerland", "India"), or null.
- countryOfOrigin: only if printed on the pack ("Made in …", "Country of Origin: …"), else null.
- category: short product category (e.g. "instant noodles", "shampoo", "smartphone").
- barcode: digits of a readable EAN/UPC barcode, else null.
- confidence: 0 to 1, how sure you are about the brand.
Never invent a brand that is not visible. Prefer null to guessing.`;

const STR = { type: 'STRING', nullable: true };
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    productName: STR, brand: STR, manufacturer: STR, brandOwner: STR, ownerCountry: STR,
    countryOfOrigin: STR, category: STR, barcode: STR, confidence: { type: 'NUMBER' },
  },
  required: ['brand', 'confidence'],
};

export class ImageAIError extends Error {
  constructor(message, { provider, status } = {}) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

function friendlyError(provider, status, apiMessage = '') {
  const name = provider === 'gemini' ? 'Gemini' : 'Cloud Vision';
  if (status === 400 && /api key/i.test(apiMessage)) return `${name}: the API key is not valid. Check it in Settings.`;
  if (status === 401 || status === 403) {
    if (/billing/i.test(apiMessage)) return `${name}: billing must be enabled on the Google Cloud project (still free up to the monthly limit).`;
    if (/not been used|disabled|enable it/i.test(apiMessage)) return `${name}: the API isn't enabled for this key's project yet. See the guide in Settings.`;
    if (/referer|referrer|restricted/i.test(apiMessage)) return `${name}: this key is restricted to other websites. Add this site to the key's allowed websites.`;
    return `${name}: the key was refused (${apiMessage || status}).`;
  }
  if (status === 404) return `${name}: model not found. Check the model name in Settings.`;
  if (status === 429) return `${name}: free quota used up for now. Try again later.`;
  return `${name}: ${apiMessage || `request failed (${status})`}`;
}

async function postJson(fetchFn, url, body, provider, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(url, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
  } catch (err) {
    throw new ImageAIError(err?.name === 'AbortError' ? 'Image recognition timed out.' : 'Image recognition needs an internet connection.', { provider });
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ImageAIError(friendlyError(provider, res.status, data?.error?.message), { provider, status: res.status });
  return data;
}

const clean = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return !s || /^(null|none|unknown|n\/a|not visible)$/i.test(s) ? null : s;
};

// ---------------------------------------------------------------- Gemini ----

export function buildGeminiRequest(base64Jpeg) {
  return {
    contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1 },
  };
}

export function parseGeminiResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let j;
  try {
    j = JSON.parse(text.replace(/^```(json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
  const r = {
    provider: 'gemini',
    productName: clean(j.productName),
    brand: clean(j.brand),
    manufacturer: clean(j.manufacturer),
    brandOwner: clean(j.brandOwner),
    ownerCountry: clean(j.ownerCountry),
    countryOfOrigin: clean(j.countryOfOrigin),
    category: clean(j.category),
    barcode: clean(j.barcode)?.replace(/\D/g, '') || null,
    confidence: typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : null,
    text: '',
    candidates: [],
  };
  r.candidates = [r.brandOwner, r.manufacturer, r.brand].filter(Boolean);
  return r;
}

export async function geminiIdentify(base64Jpeg, { key, model = DEFAULT_GEMINI_MODEL, fetchFn = globalThis.fetch, timeoutMs = 25000 }) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const data = await postJson(fetchFn, url, buildGeminiRequest(base64Jpeg), 'gemini', timeoutMs);
  return parseGeminiResponse(data);
}

// ---------------------------------------------------------- Cloud Vision ----

export function buildVisionRequest(base64Jpeg) {
  return {
    requests: [{
      image: { content: base64Jpeg },
      features: [
        { type: 'LOGO_DETECTION', maxResults: 3 },
        { type: 'WEB_DETECTION', maxResults: 8 },
        { type: 'TEXT_DETECTION' },
      ],
      imageContext: { languageHints: ['en', 'hi'] },
    }],
  };
}

// Web entities that describe the kind of thing rather than who made it.
const GENERIC_ENTITY = /^(product|brand|food|snack|packaging|package|label|text|font|logo|bottle|box|carton|flavor|flavour|ingredient|recipe|instant noodles|noodle|biscuit|cookie|shampoo|soap|drink|beverage|juice|chocolate|bar|chips|potato chip|india|indian cuisine|graphics|illustration|design|advertising|plastic|paper|close-up|still life photography)$/i;

export function parseVisionResponse(data) {
  const r0 = data?.responses?.[0];
  if (!r0) return null;
  if (r0.error) throw new ImageAIError(friendlyError('vision', r0.error.code === 7 ? 403 : 400, r0.error.message), { provider: 'vision' });
  const logo = r0.logoAnnotations?.find((l) => (l.score ?? 1) >= 0.5)?.description || null;
  const web = r0.webDetection || {};
  const entities = (web.webEntities || [])
    .filter((e) => e.description && (e.score ?? 0) >= 0.4 && !GENERIC_ENTITY.test(e.description))
    .map((e) => e.description);
  const bestGuess = clean(web.bestGuessLabels?.[0]?.label);
  return {
    provider: 'vision',
    productName: bestGuess,
    brand: clean(logo),
    manufacturer: null,
    brandOwner: null,
    ownerCountry: null,
    countryOfOrigin: null,
    category: null,
    barcode: null,
    confidence: r0.logoAnnotations?.[0]?.score ?? null,
    text: r0.fullTextAnnotation?.text || r0.textAnnotations?.[0]?.description || '',
    candidates: [...new Set([logo, ...entities].filter(Boolean))].slice(0, 5),
  };
}

export async function visionIdentify(base64Jpeg, { key, fetchFn = globalThis.fetch, timeoutMs = 20000 }) {
  const data = await postJson(fetchFn, `${VISION_URL}?key=${encodeURIComponent(key)}`, buildVisionRequest(base64Jpeg), 'vision', timeoutMs);
  return parseVisionResponse(data);
}

// ------------------------------------------------------------- Combined ----

/** Merge Gemini's understanding with Vision's logo/web/text results. */
export function mergeResults(results) {
  const ok = results.filter(Boolean);
  if (!ok.length) return null;
  const pick = (f) => ok.map((r) => r[f]).find((v) => v != null && v !== '') ?? null;
  return {
    provider: ok.map((r) => r.provider).join('+'),
    productName: pick('productName'),
    brand: pick('brand'),
    manufacturer: pick('manufacturer'),
    brandOwner: pick('brandOwner'),
    ownerCountry: pick('ownerCountry'),
    countryOfOrigin: pick('countryOfOrigin'),
    category: pick('category'),
    barcode: pick('barcode'),
    confidence: pick('confidence'),
    text: ok.map((r) => r.text).find(Boolean) || '',
    candidates: [...new Set(ok.flatMap((r) => r.candidates))],
  };
}

/**
 * Identify the product in a JPEG (base64, no data: prefix) using whichever
 * services are configured. Resolves to { result, errors[] }.
 */
export async function identifyProduct(base64Jpeg, settings, { fetchFn = globalThis.fetch } = {}) {
  const jobs = [];
  if (usesGemini(settings)) jobs.push(geminiIdentify(base64Jpeg, { key: settings.geminiKey, model: settings.geminiModel, fetchFn }));
  if (usesVision(settings)) jobs.push(visionIdentify(base64Jpeg, { key: settings.visionKey, fetchFn }));
  const settled = await Promise.allSettled(jobs);
  return {
    result: mergeResults(settled.filter((s) => s.status === 'fulfilled').map((s) => s.value)),
    errors: settled.filter((s) => s.status === 'rejected').map((s) => s.reason?.message || String(s.reason)),
  };
}

export const usesGemini = (s) => ['gemini', 'both'].includes(s?.provider) && !!s.geminiKey;
export const usesVision = (s) => ['vision', 'both'].includes(s?.provider) && !!s.visionKey;
export const imageAIEnabled = (s) => usesGemini(s) || usesVision(s);

// ------------------------------------------------------------ Key tests ----

// An 8×8 white JPEG: the cheapest possible real request.
const TINY_JPEG = '/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgUFBcUFxsbGxsbGyAeICEhISAgICAhISEkJCQqKiokJCQhISQkKCgqKi4vLisrKisvLzIyMjw8OTlGRkhWVmf/xABLAAEBAAAAAAAAAAAAAAAAAAAABwEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAgACAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AL+AD//Z';

/** Check a Gemini key without using image quota: list the model. */
export async function testGeminiKey(key, model = DEFAULT_GEMINI_MODEL, { fetchFn = globalThis.fetch } = {}) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model || DEFAULT_GEMINI_MODEL)}?key=${encodeURIComponent(key)}`;
  const data = await postJson(fetchFn, url, null, 'gemini', 10000);
  return `Key works — ${data.displayName || model} is available.`;
}

/** Check a Vision key with a tiny blank image (uses one free unit). */
export async function testVisionKey(key, { fetchFn = globalThis.fetch } = {}) {
  const body = { requests: [{ image: { content: TINY_JPEG }, features: [{ type: 'LABEL_DETECTION', maxResults: 1 }] }] };
  const data = await postJson(fetchFn, `${VISION_URL}?key=${encodeURIComponent(key)}`, body, 'vision', 10000);
  parseVisionResponse(data); // throws on per-image errors (e.g. billing)
  return 'Key works — Cloud Vision is enabled.';
}
