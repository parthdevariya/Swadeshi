import { BRANDS } from './brands.js';
import { classify, guessCategory } from './classifier.js';
import { cleanCode, isValidGtin } from './barcode.js';
import { identifyProduct, imageAIEnabled, testGeminiKey, testVisionKey } from './imageAI.js';
import { loadSettings, saveSettings } from './settings.js';
import { lookupBarcode } from './lookup.js';
import { Camera, createBarcodeReader, fileToCanvas } from './scanner.js';
import { readText, warmUpOcr } from './ocr.js';
import { extractCompanyNames, setLearnedBrands } from './textParser.js';
import { setupInstall } from './install.js';
import { forgetBrand, learnBrand, loadLearned, makeLearnedEntry, suggestionUrl } from './learnedBrands.js';
import { brandBackground, researchFirst, webSearchUrl } from './webLookup.js';

const $ = (sel) => document.querySelector(sel);
const HISTORY_KEY = 'swadeshi-history-v1';

const camera = new Camera($('#video'));
let reader = null;
let current = {};
let runId = 0; // bumps on every new scan so stale async work is discarded
let settings = loadSettings();
let refining = null; // { barcode, online } when the user is adding a label photo to a barcode scan

// ====================================================================
// Camera
// ====================================================================

$('#start').addEventListener('click', startScanning);
$('#close-cam').addEventListener('click', closeCamera);
$('#shutter').addEventListener('click', captureAndRead);

async function startScanning({ labelOnly = false } = {}) {
  if (!labelOnly) refining = null;
  setStatus('');
  $('#stage').classList.remove('compact');
  $('#still').hidden = true;
  $('#start').hidden = true;
  $('#controls').hidden = false;
  $('#stage').classList.add('live');
  try {
    await camera.start();
  } catch (err) {
    closeCamera();
    setStatus(cameraErrorMessage(err), true);
    return;
  }
  warmUpOcr().catch(() => {}); // download the OCR engine while the user aims
  $('#live-hint').innerHTML = labelOnly
    ? 'Aim at the back of the pack — “Manufactured by” / “Country of Origin” — and tap the button.'
    : 'Barcodes scan automatically.<br>No barcode? Tap the button to read the label.';
  if (labelOnly) return;
  try {
    reader ??= await createBarcodeReader();
    camera.detectBarcodes(reader, onLiveBarcode);
  } catch {
    $('#live-hint').textContent = 'Tap the button to read the product.';
  }
}

function closeCamera() {
  camera.stop();
  $('#stage').classList.remove('live', 'compact');
  $('#controls').hidden = true;
  $('#start').hidden = false;
  $('#still').hidden = true;
}

function freeze(canvas) {
  $('#still').src = canvas.toDataURL('image/jpeg', 0.8);
  $('#still').hidden = false;
  $('#stage').classList.add('compact'); // make room for the answer
}

function onLiveBarcode(code) {
  navigator.vibrate?.(60);
  freeze(camera.capture());
  camera.stop();
  $('#controls').hidden = true;
  analyze({ barcode: code });
}

async function captureAndRead() {
  if (!camera.running) return;
  const canvas = camera.capture();
  freeze(canvas);
  camera.stop();
  $('#controls').hidden = true;
  await analyzeImage(canvas);
}

$('#photo-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const canvas = await fileToCanvas(file);
  freeze(canvas);
  camera.stop();
  $('#controls').hidden = true;
  $('#stage').classList.add('live');
  $('#start').hidden = true;
  await analyzeImage(canvas);
});

/** A still image may hold a barcode, label text, or both — try everything. */
async function analyzeImage(canvas) {
  const id = ++runId;
  resetResult();
  const useAI = imageAIEnabled(settings);
  const labels = ['Looking for a barcode', 'Reading the text', 'Checking the brand', 'Searching the web'];
  if (useAI) labels.splice(1, 0, `Recognising the product (${providerName()})`);
  const steps = showSteps(labels);
  const S = useAI ? { code: 0, ai: 1, text: 2, brand: 3 } : { code: 0, text: 1, brand: 2 };

  // Start the cloud recognition right away; it runs alongside the on-device work.
  if (useAI) steps.active(S.ai);
  const aiJob = useAI ? identifyProduct(toJpegBase64(canvas), settings) : null;

  steps.active(S.code);
  let barcode = null;
  try {
    reader ??= await createBarcodeReader();
    barcode = await reader.detect(canvas);
  } catch {
    // Barcode library unavailable — the picture and text may be enough.
  }
  if (id !== runId) return;
  steps.done(S.code, barcode ? `Barcode ${barcode}` : 'No barcode — using the picture');
  current = { barcode: barcode ? cleanCode(barcode) : refining?.barcode };
  const lookupOnline = (code) => (code && code !== refining?.barcode ? lookupBarcode(code) : Promise.resolve(refining?.online ?? null));
  let online = lookupOnline(current.barcode);
  refining = null;

  steps.active(S.text);
  const ocrJob = readText(canvas, (pct) => steps.progress(S.text, pct))
    .catch((err) => ({ text: '', headline: null, error: err.message }));

  if (aiJob) {
    const { result, errors } = await aiJob;
    if (id !== runId) return;
    current.ai = result;
    if (result) {
      steps.done(S.ai, `Looks like: ${result.productName || result.brand || 'an unbranded product'}`);
      // The model may read a barcode the scanner missed.
      if (!current.barcode && result.barcode && isValidGtin(result.barcode)) {
        current.barcode = result.barcode;
        online = lookupOnline(result.barcode);
      }
    } else {
      steps.fail(S.ai, errors[0] || 'Couldn’t recognise the product');
    }
  }

  const ocr = await ocrJob;
  if (id !== runId) return;
  current.labelText = [ocr.text, current.ai?.text].filter(Boolean).join('\n');
  current.headline = ocr.headline || undefined;
  if (current.labelText.trim()) steps.done(S.text, ocr.headline ? `Read “${ocr.headline}”` : 'Text read');
  else if (current.ai?.brand) steps.done(S.text, 'No readable text — recognised from the picture instead');
  else steps.fail(S.text, ocr.error || 'Couldn’t read any text — try closer, with more light');

  await finishAnalysis(id, steps, online, S.brand);
}

/** Downscaled JPEG for upload: enough detail to recognise a pack, small enough to send fast. */
function toJpegBase64(canvas, maxSide = 1024) {
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * scale);
  c.height = Math.round(canvas.height * scale);
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function analyze(input) {
  const id = ++runId;
  resetResult();
  current = { ...input, barcode: input.barcode ? cleanCode(input.barcode) : undefined };
  const steps = showSteps([current.barcode ? `Barcode ${current.barcode}` : `Brand “${current.brandQuery}”`, 'Checking the brand', 'Searching the web']);
  steps.done(0);
  const online = current.barcode ? lookupBarcode(current.barcode) : Promise.resolve(null);
  await finishAnalysis(id, steps, online, 1);
}

/** Shared tail: product database → verdict → web research for ownership and details. */
async function finishAnalysis(id, steps, onlinePromise, first) {
  steps.active(first);
  current.online = await onlinePromise;
  if (id !== runId) return;
  let result = classify(current);
  steps.done(first, current.online ? `Found in ${current.online.source}`
    : result.brand?.learned ? `Saved brand: ${result.brand.name}`
      : result.brand ? `Known brand: ${result.brand.name}` : 'Not in our list yet');
  render(result);

  // ---- Web research (free: Wikidata + Wikipedia) ----
  steps.active(first + 1);
  if (!navigator.onLine) {
    steps.fail(first + 1, 'Offline — showing what we know locally');
    saveHistory(result);
    return;
  }
  if (!result.brand) {
    current.web = await researchFirst(candidateNames());
    if (id !== runId) return;
    result = classify(current);
    if (result.brand?.source === 'web') rememberBrand(result);
  }
  current.wiki = result.brand
    ? await brandBackground({ wikipediaTitle: current.web?.wikipediaTitle, brand: result.brand.name, owner: result.brand.owner })
    : null;
  if (id !== runId) return;
  steps.done(first + 1, current.learned ? `Learned ${current.learned.name} — added to your brand list`
    : current.web ? `Wikidata: owned by ${current.web.owner}` : current.wiki ? 'Found background on Wikipedia' : 'Nothing more found online');
  render(result);
  saveHistory(result);
}

// ====================================================================
// Learned brands (saved on this device)
// ====================================================================

const NOT_A_BRAND = /\b(net|wt|weight|ingredients?|origin|mfd|mfg|manufactured|marketed|packed|best before|mrp|nutrition|country|batch|veg|contains|price|use by|expiry)\b|\d/i;

/** Save a brand found on the web so the next scan is instant and offline. */
function rememberBrand(result) {
  const aliases = [];
  if (current.brandQuery) aliases.push(current.brandQuery);
  if (current.ai?.brand) aliases.push(current.ai.brand);
  if (current.online?.brands) aliases.push(...current.online.brands.split(','));
  // The big text on the pack (e.g. a product line name) points to this owner next time.
  if (current.headline && !NOT_A_BRAND.test(current.headline)) aliases.push(current.headline);
  const entry = makeLearnedEntry(current.web, {
    aliases,
    category: guessCategory(`${current.online?.categories || ''} ${current.web.description || ''}`),
  });
  refreshLearned(learnBrand(entry));
  current.learned = entry;
  result.brand = { ...result.brand, ...entry, source: 'web' };
}

function refreshLearned(list = loadLearned()) {
  setLearnedBrands(list);
  fillBrandSuggestions(list);
  renderLearned(list);
}

function forget(name) {
  refreshLearned(forgetBrand(name));
}

function renderLearned(list) {
  $('#learned-section').hidden = !list.length;
  $('#learned-count').textContent = String(list.length);
  $('#learned').replaceChildren(...list.map((b) =>
    el('li', {},
      el('div', { class: 'learned-info' },
        el('strong', {}, `${b.indian ? '🇮🇳' : '🌍'} ${b.name}`),
        el('span', {}, b.owner === b.name ? ` — ${b.country}` : ` — ${b.owner} (${b.country})`)),
      el('div', { class: 'learned-actions' },
        el('a', { href: suggestionUrl(b), target: '_blank', rel: 'noopener', title: 'Propose for the shared list on GitHub' }, 'Suggest'),
        el('button', { type: 'button', class: 'link', onclick: () => forget(b.name) }, 'Remove')))));
}

/** Names worth researching, most reliable first. */
function candidateNames() {
  const names = [];
  if (current.brandQuery) names.push(current.brandQuery);
  if (current.ai) names.push(current.ai.brandOwner, current.ai.manufacturer, current.ai.brand);
  if (current.online?.brandOwner) names.push(current.online.brandOwner);
  if (current.online?.brands) names.push(...current.online.brands.split(',').map((s) => s.trim()));
  if (current.labelText) names.push(...extractCompanyNames(current.labelText));
  if (current.headline) names.push(current.headline);
  if (current.ai?.candidates) names.push(...current.ai.candidates);
  return names.filter(Boolean).slice(0, 6);
}

function cameraErrorMessage(err) {
  if (!window.isSecureContext) return 'The camera needs a secure (https) page. You can still choose a photo or type a brand.';
  if (err?.name === 'NotAllowedError') return 'Camera permission was denied. Allow it in your browser settings, or choose a photo / type a brand.';
  if (err?.name === 'NotFoundError') return 'No camera found. Choose a photo or type a brand instead.';
  return err?.message || 'Could not start the camera.';
}

// ====================================================================
// Brand search
// ====================================================================

/** Autocomplete: curated brands plus the ones learned on this device. */
function fillBrandSuggestions(learned) {
  const names = new Set([...BRANDS.map((b) => b.name), ...learned.flatMap((b) => [b.name, ...(b.aliases || [])])]);
  $('#brand-list').replaceChildren(...[...names].sort().map((n) => Object.assign(document.createElement('option'), { value: n })));
}

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#brand-input').value.trim();
  if (!q) return;
  $('#brand-input').blur();
  checkBrand(q);
});

function checkBrand(q) {
  closeCamera();
  $('#brand-input').value = q;
  analyze({ brandQuery: q });
}

// ====================================================================
// Progress steps
// ====================================================================

function showSteps(labels) {
  const ol = $('#steps');
  ol.hidden = false;
  ol.replaceChildren(...labels.map((l) => el('li', { class: 'pending' }, el('span', { class: 'txt' }, l))));
  const li = (i) => ol.children[i];
  const set = (i, cls, text) => {
    li(i).className = cls;
    if (text) li(i).querySelector('.txt').textContent = text;
  };
  return {
    active: (i) => set(i, 'active'),
    done: (i, text) => set(i, 'done', text),
    fail: (i, text) => set(i, 'fail', text),
    progress: (i, pct) => set(i, 'active', `Reading the text… ${pct}%`),
  };
}

function setStatus(msg, isError = false) {
  const s = $('#status');
  s.hidden = !msg;
  s.textContent = msg || '';
  s.classList.toggle('error', isError);
}

function resetResult() {
  setStatus('');
  $('#result').hidden = true;
}

// ====================================================================
// Result rendering
// ====================================================================

const TONE = {
  swadeshi: 'good', 'indian-brand': 'good', 'likely-indian': 'good',
  'indian-brand-imported': 'warn', 'made-in-india': 'warn', 'likely-foreign': 'warn',
  foreign: 'bad', 'foreign-brand': 'bad', unknown: 'none',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

function productTitle(r) {
  const known = r.brand?.source === 'web' || r.brand?.learned ? null : r.brand?.name;
  return current.online?.productName || current.ai?.productName || known || current.brandQuery || current.headline || r.brand?.name
    || (current.barcode ? `Barcode ${current.barcode}` : 'Scanned product');
}

function render(r) {
  const box = $('#result');
  box.hidden = false;
  const online = current.online;
  const wiki = current.wiki;
  const searchName = r.brand?.name || online?.brands || current.headline || current.brandQuery || current.barcode;

  box.replaceChildren(
    el('div', { class: `verdict ${TONE[r.verdict]}` },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, r.emoji),
      el('div', {}, el('h2', {}, r.label), el('p', {}, r.summary)),
    ),
    el('div', { class: 'body' },
      el('div', { class: 'product' },
        online?.image ? el('img', { src: online.image, alt: '' }) : null,
        el('div', {},
          el('div', { class: 'name' }, productTitle(r)),
          r.brand ? el('div', { class: 'meta' }, r.brand.owner === r.brand.name
            ? `${r.brand.name} · ${r.brand.country}`
            : `${r.brand.name} · owned by ${r.brand.owner}${r.brand.country ? ` (${r.brand.country})` : ''}`) : null,
          r.confidence !== 'none' ? el('span', { class: 'pill' }, `Confidence: ${r.confidence}`) : null,
        ),
      ),

      r.evidence.length ? [el('h3', {}, 'Why'), el('ul', { class: 'evidence' }, r.evidence.map((e) => el('li', { class: e.direction }, e.text)))] : null,

      r.brand?.learned ? el('div', { class: 'learned-note' },
        el('p', {}, current.learned
          ? `➕ ${r.brand.name} wasn’t in our list, so we looked it up and saved it on this device. Next time it’s instant — even offline.`
          : `💾 ${r.brand.name} is in your saved brands (learned from Wikidata).`),
        el('div', { class: 'learned-actions' },
          el('a', { class: 'btn', href: suggestionUrl(r.brand), target: '_blank', rel: 'noopener' }, '📤 Suggest for everyone'),
          el('button', { type: 'button', onclick: () => { forget(r.brand.name); current.learned = null; render(classify(current)); } }, 'Not right? Remove')),
      ) : null,

      r.alternatives.length ? [
        el('h3', {}, 'Swadeshi alternatives'),
        el('ul', { class: 'alts' }, r.alternatives.map((a) =>
          el('li', {}, el('button', { type: 'button', title: a.owner, onclick: () => checkBrand(a.name) }, a.name)))),
      ] : null,

      wiki ? el('div', { class: 'about' },
        el('h3', {}, `About ${wiki.title}`),
        el('div', { class: 'about-body' },
          wiki.image ? el('img', { src: wiki.image, alt: '', loading: 'lazy' }) : null,
          el('p', {}, wiki.extract),
        ),
        wiki.url ? el('a', { href: wiki.url, target: '_blank', rel: 'noopener' }, 'Read more on Wikipedia →') : null,
      ) : null,

      current.labelText ? el('details', { class: 'ocr' },
        el('summary', {}, 'Text read from the pack'),
        el('textarea', { id: 'ocr-text', rows: '6' }, current.labelText),
        el('button', { type: 'button', onclick: recheckText }, 'Re-check edited text'),
      ) : null,

      r.manufacture == null && !current.labelText && current.barcode
        ? el('button', { type: 'button', class: 'refine', onclick: readLabelToo }, '🏷️ Not sure yet — photograph the label to confirm where it was made')
        : null,

      current.labelText !== undefined && !imageAIEnabled(settings)
        ? el('p', { class: 'ai-tip' }, '💡 Want the app to recognise products from the picture itself? ',
          el('button', { type: 'button', onclick: openSettings }, 'Add a free Google key in Settings'))
        : null,

      el('div', { class: 'result-actions' },
        el('button', { type: 'button', class: 'primary', onclick: scanAnother }, '📷 Scan another'),
        searchName ? el('a', { class: 'btn', href: webSearchUrl(searchName), target: '_blank', rel: 'noopener' }, '🌐 Search the web') : null,
      ),
      online ? el('p', { class: 'hint' }, `Product data: ${online.source}`) : null,
    ),
  );
}

async function recheckText() {
  current.labelText = $('#ocr-text').value;
  current.web = undefined;
  current.wiki = undefined;
  const id = ++runId;
  const steps = showSteps(['Text edited', 'Checking the brand', 'Searching the web']);
  steps.done(0);
  await finishAnalysis(id, steps, Promise.resolve(current.online), 1);
}

function readLabelToo() {
  refining = { barcode: current.barcode, online: current.online };
  runId++;
  $('#result').hidden = true;
  $('#steps').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  startScanning({ labelOnly: true });
}

function scanAnother() {
  runId++;
  $('#result').hidden = true;
  $('#steps').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  startScanning();
}

// ====================================================================
// History
// ====================================================================

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(r) {
  const entry = {
    title: productTitle(r),
    emoji: r.emoji,
    label: r.label,
    barcode: current.barcode || null,
    brandQuery: r.brand?.name || current.brandQuery || null,
    at: Date.now(),
  };
  const list = loadHistory().filter((h) => h.title !== entry.title);
  list.unshift(entry);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    // Storage unavailable (private mode) — history is a convenience only.
  }
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  $('#history-section').hidden = !list.length;
  $('#history').replaceChildren(...list.map((h) =>
    el('li', {}, el('button', {
      type: 'button',
      onclick: () => {
        closeCamera();
        if (h.barcode) analyze({ barcode: h.barcode });
        else if (h.brandQuery) checkBrand(h.brandQuery);
      },
    },
    el('span', {}, `${h.emoji} ${h.title} — ${h.label}`),
    el('span', { class: 'when' }, new Date(h.at).toLocaleDateString())))));
}

$('#clear-history').addEventListener('click', () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  renderHistory();
});

renderHistory();
refreshLearned();

// Returning users who already granted camera access go straight to scanning,
// as does the "Scan a product" home-screen shortcut.
if (new URLSearchParams(location.search).get('scan') === '1') startScanning();
else {
  navigator.permissions?.query({ name: 'camera' })
    .then((p) => { if (p.state === 'granted') startScanning(); })
    .catch(() => {});
}

// ====================================================================
// Install as an app
// ====================================================================

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 3500);
}

// ====================================================================
// Settings (image recognition API keys)
// ====================================================================

function providerName(s = settings) {
  return { gemini: 'Gemini', vision: 'Cloud Vision', both: 'Gemini + Vision' }[s.provider] || 'AI';
}

const settingsSheet = $('#settings-sheet');
const form = $('#settings-form');

function openSheet(sheet) {
  sheet.hidden = false;
  requestAnimationFrame(() => sheet.classList.add('open'));
}

function closeSheet(sheet) {
  sheet.classList.remove('open');
  setTimeout(() => (sheet.hidden = true), 250);
}

function formValues() {
  return {
    provider: form.querySelector('input[name="provider"]:checked')?.value || 'off',
    geminiKey: $('#gemini-key').value,
    geminiModel: $('#gemini-model').value,
    visionKey: $('#vision-key').value,
  };
}

function syncKeyBlocks() {
  const p = formValues().provider;
  form.querySelector('[data-for="gemini"]').hidden = !['gemini', 'both'].includes(p);
  form.querySelector('[data-for="vision"]').hidden = !['vision', 'both'].includes(p);
}

function openSettings() {
  form.querySelector(`input[name="provider"][value="${settings.provider}"]`).checked = true;
  $('#gemini-key').value = settings.geminiKey;
  $('#gemini-model').value = settings.geminiModel;
  $('#vision-key').value = settings.visionKey;
  form.querySelectorAll('.key-status').forEach((el) => { el.textContent = ''; el.className = 'key-status'; });
  form.querySelectorAll('.site-origin').forEach((el) => (el.textContent = `${location.origin}/*`));
  syncKeyBlocks();
  openSheet(settingsSheet);
}

$('#settings-btn').addEventListener('click', openSettings);
form.querySelectorAll('input[name="provider"]').forEach((r) => r.addEventListener('change', syncKeyBlocks));
form.querySelector('[data-close]').addEventListener('click', () => closeSheet(settingsSheet));
settingsSheet.addEventListener('click', (e) => { if (e.target === settingsSheet) closeSheet(settingsSheet); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !settingsSheet.hidden) closeSheet(settingsSheet); });

form.querySelectorAll('.reveal').forEach((btn) => btn.addEventListener('click', () => {
  const input = $(`#${btn.dataset.target}`);
  input.type = input.type === 'password' ? 'text' : 'password';
}));

form.querySelectorAll('[data-test]').forEach((btn) => btn.addEventListener('click', async () => {
  const which = btn.dataset.test;
  const v = formValues();
  const key = which === 'gemini' ? v.geminiKey.trim() : v.visionKey.trim();
  const status = $(`#${which}-status`);
  if (!key) {
    status.textContent = 'Paste a key first.';
    status.className = 'key-status bad';
    return;
  }
  status.textContent = 'Testing…';
  status.className = 'key-status';
  btn.disabled = true;
  try {
    status.textContent = `✅ ${which === 'gemini' ? await testGeminiKey(key, v.geminiModel.trim()) : await testVisionKey(key)}`;
    status.className = 'key-status ok';
  } catch (err) {
    status.textContent = `❌ ${err.message}`;
    status.className = 'key-status bad';
  } finally {
    btn.disabled = false;
  }
}));

form.querySelector('[data-clear]').addEventListener('click', () => {
  $('#gemini-key').value = '';
  $('#vision-key').value = '';
  form.querySelector('input[name="provider"][value="off"]').checked = true;
  syncKeyBlocks();
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = formValues();
  if (v.provider !== 'off' && !imageAIEnabled({ ...v, geminiKey: v.geminiKey.trim(), visionKey: v.visionKey.trim() })) {
    const which = v.provider === 'vision' ? 'vision' : 'gemini';
    $(`#${which}-status`).textContent = 'Add a key to turn this on, or choose Off.';
    $(`#${which}-status`).className = 'key-status bad';
    return;
  }
  settings = saveSettings(v);
  closeSheet(settingsSheet);
  toast(imageAIEnabled(settings) ? `✅ Photo recognition on (${providerName()})` : 'Saved — photo recognition is off');
});

setupInstall({
  sheet: $('#install-sheet'),
  headerButton: $('#install-btn'),
  onInstalled: () => toast('✅ Installed! Open Swadeshi from your home screen.'),
});

// Release the camera when the app is hidden; it restarts with one tap.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && camera.running) closeCamera();
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
