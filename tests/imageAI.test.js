import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGeminiRequest, parseGeminiResponse, parseVisionResponse, mergeResults,
  identifyProduct, testGeminiKey, testVisionKey, imageAIEnabled,
} from '../js/imageAI.js';
import { classify } from '../js/classifier.js';
import { loadSettings, saveSettings } from '../js/settings.js';

const geminiReply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const visionReply = {
  responses: [{
    logoAnnotations: [{ description: 'Maggi', score: 0.93 }],
    webDetection: {
      bestGuessLabels: [{ label: 'maggi masala noodles' }],
      webEntities: [{ description: 'Maggi', score: 1.2 }, { description: 'Instant noodles', score: 0.9 }, { description: 'Nestlé', score: 0.7 }],
    },
    fullTextAnnotation: { text: 'MAGGI\n2-Minute Noodles\nMfd. by Nestle India Ltd, Moga, Punjab' },
  }],
};

function fakeFetch(routes, calls = []) {
  return (url, opts) => {
    calls.push({ url, opts });
    const [, handler] = routes.find(([re]) => re.test(url)) || [];
    const { status = 200, body = {} } = handler ? handler(url, opts) : { status: 404 };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
  };
}

test('Gemini request sends the image and asks for structured JSON', () => {
  const req = buildGeminiRequest('BASE64');
  assert.equal(req.contents[0].parts[1].inlineData.data, 'BASE64');
  assert.equal(req.contents[0].parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(req.generationConfig.responseMimeType, 'application/json');
  assert.ok(req.generationConfig.responseSchema.properties.brandOwner);
});

test('parses Gemini output and normalises "unknown" to null', () => {
  const r = parseGeminiResponse(geminiReply({ productName: 'Maggi Masala Noodles', brand: 'Maggi', brandOwner: 'Nestlé', ownerCountry: 'Switzerland', countryOfOrigin: 'unknown', barcode: '890 1058 000000', confidence: 0.9 }));
  assert.equal(r.brand, 'Maggi');
  assert.equal(r.countryOfOrigin, null);
  assert.equal(r.barcode, '8901058000000');
  assert.deepEqual(r.candidates, ['Nestlé', 'Maggi']);
  assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }), null);
  // Thought parts from thinking models are ignored.
  const withThought = { candidates: [{ content: { parts: [{ text: 'let me think…', thought: true }, { text: '{"brand":"Amul","confidence":0.8}', thoughtSignature: 'x' }] } }] };
  assert.equal(parseGeminiResponse(withThought).brand, 'Amul');
});

test('parses Cloud Vision logo, web and text results, dropping generic entities', () => {
  const r = parseVisionResponse(visionReply);
  assert.equal(r.brand, 'Maggi');
  assert.equal(r.productName, 'maggi masala noodles');
  assert.deepEqual(r.candidates, ['Maggi', 'Nestlé']);
  assert.match(r.text, /Nestle India/);
});

test('merging prefers Gemini fields and keeps Vision text', () => {
  const g = parseGeminiResponse(geminiReply({ brand: 'Maggi', brandOwner: 'Nestlé', ownerCountry: 'Switzerland', confidence: 0.9 }));
  const v = parseVisionResponse(visionReply);
  const m = mergeResults([g, v]);
  assert.equal(m.provider, 'gemini+vision');
  assert.equal(m.brandOwner, 'Nestlé');
  assert.equal(m.productName, 'maggi masala noodles');
  assert.match(m.text, /Moga/);
});

test('identifyProduct calls the right endpoints with the key and survives one failing', async () => {
  const calls = [];
  const fetchFn = fakeFetch([
    [/generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-flash-latest:generateContent$/, () => ({ body: geminiReply({ brand: 'Parle-G', brandOwner: 'Parle Products', ownerCountry: 'India', confidence: 0.95 }) })],
    [/vision\.googleapis\.com\/v1\/images:annotate\?key=V-KEY/, () => ({ status: 429, body: { error: { code: 429, message: 'Quota exceeded' } } })],
  ], calls);
  const { result, errors } = await identifyProduct('IMG', { provider: 'both', geminiKey: 'G-KEY', visionKey: 'V-KEY', geminiModel: 'gemini-flash-latest' }, { fetchFn });
  assert.equal(result.brand, 'Parle-G');
  assert.deepEqual(errors, ['Cloud Vision: free quota used up for now. Try again later.']);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers['x-goog-api-key'], 'G-KEY');
  assert.ok(!calls[0].url.includes('G-KEY'), 'Gemini key must not be in the URL');
});

test('friendly errors for bad keys, disabled APIs and billing', async () => {
  const bad = fakeFetch([[/models\//, () => ({ status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } })]]);
  await assert.rejects(testGeminiKey('x', undefined, { fetchFn: bad }), /key is not valid/);
  const disabled = fakeFetch([[/vision/, () => ({ status: 403, body: { error: { message: 'Cloud Vision API has not been used in project 123 before or it is disabled.' } } })]]);
  await assert.rejects(testVisionKey('x', { fetchFn: disabled }), /isn't enabled/);
  const billing = fakeFetch([[/vision/, () => ({ body: { responses: [{ error: { code: 7, message: 'This API method requires billing to be enabled.' } }] } })]]);
  await assert.rejects(testVisionKey('x', { fetchFn: billing }), /billing must be enabled/);
  const offline = () => Promise.reject(new TypeError('Failed to fetch'));
  await assert.rejects(testGeminiKey('x', undefined, { fetchFn: offline }), /internet connection/);
});

test('key test success messages', async () => {
  const ok = fakeFetch([[/models\/gemini-flash-latest$/, () => ({ body: { displayName: 'Gemini Flash Latest' } })], [/vision/, () => ({ body: { responses: [{}] } })]]);
  assert.match(await testGeminiKey('K', undefined, { fetchFn: ok }), /Key works/);
  assert.match(await testVisionKey('K', { fetchFn: ok }), /Key works/);
});

test('only enabled when the chosen provider has a key', () => {
  assert.equal(imageAIEnabled({ provider: 'gemini', geminiKey: '' }), false);
  assert.equal(imageAIEnabled({ provider: 'off', geminiKey: 'k' }), false);
  assert.equal(imageAIEnabled({ provider: 'both', visionKey: 'k' }), true);
});

test('settings round-trip and sanitising', () => {
  const m = new Map();
  const store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  saveSettings({ provider: 'gemini', geminiKey: '  AIzaKEY  ', geminiModel: '' }, store);
  const s = loadSettings(store);
  assert.equal(s.geminiKey, 'AIzaKEY');
  assert.equal(s.geminiModel, 'gemini-flash-latest');
  assert.equal(saveSettings({ provider: 'evil' }, store).provider, 'off');
});

// ---- How recognition results feed the verdict ----

test('a recognised brand from the photo is checked against the curated list', () => {
  const r = classify({ ai: { brand: 'Maggi', brandOwner: 'Some Wrong Owner', ownerCountry: 'India', candidates: [] } });
  assert.equal(r.brand.owner, 'Nestlé'); // curated list beats the model's claim
  assert.equal(r.ownership, 'foreign');
});

test('unknown brand falls back to the model with low weight, Wikidata beats it', () => {
  const ai = { brand: 'Zentro Crisps', brandOwner: 'Zentro Foods', ownerCountry: 'India', candidates: [] };
  const r = classify({ ai });
  assert.equal(r.verdict, 'indian-brand');
  assert.equal(r.confidence, 'low');
  assert.ok(r.evidence.some((e) => /not yet confirmed/.test(e.text)));
  const web = { name: 'Zentro Foods', owner: 'Global Snacks Inc', ownerCountry: 'United States', chain: ['Zentro Foods', 'Global Snacks Inc'] };
  assert.equal(classify({ ai, web }).ownership, 'foreign');
});

test('country of origin read by the model counts as manufacture evidence', () => {
  const r = classify({ brandQuery: 'Amul', ai: { brand: 'Amul', countryOfOrigin: 'India', candidates: [] } });
  assert.equal(r.verdict, 'swadeshi');
});

test('retries Gemini once when Google is briefly overloaded', async () => {
  const { geminiIdentify } = await import('../js/imageAI.js');
  let n = 0;
  const flaky = () => {
    n++;
    const busy = n === 1;
    return Promise.resolve({
      ok: !busy,
      status: busy ? 503 : 200,
      json: () => Promise.resolve(busy
        ? { error: { code: 503, message: 'This model is currently experiencing high demand.' } }
        : geminiReply({ brand: 'Amul', confidence: 0.9 })),
    });
  };
  assert.equal((await geminiIdentify('IMG', { key: 'k', fetchFn: flaky, retryDelayMs: 1 })).brand, 'Amul');
  const urls = [];
  const mainBusy = (url) => {
    urls.push(url);
    const busy = !url.includes('flash-lite');
    return Promise.resolve({ ok: !busy, status: busy ? 503 : 200, json: () => Promise.resolve(busy ? { error: { message: 'high demand' } } : geminiReply({ brand: 'Dabur', confidence: 0.8 })) });
  };
  assert.equal((await geminiIdentify('IMG', { key: 'k', fetchFn: mainBusy, retryDelayMs: 1 })).brand, 'Dabur');
  assert.equal(urls.length, 3);
  assert.match(urls[2], /gemini-flash-lite-latest:generateContent$/);
  const alwaysBusy = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: { message: 'high demand' } }) });
  await assert.rejects(geminiIdentify('IMG', { key: 'k', fetchFn: alwaysBusy, retryDelayMs: 1 }), /busy right now/);
});
