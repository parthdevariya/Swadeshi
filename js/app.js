import { BRANDS } from './brands.js';
import { classify } from './classifier.js';
import { cleanCode, isValidGtin } from './barcode.js';
import { lookupBarcode } from './lookup.js';
import { startScanner, decodeImageFile } from './scanner.js';
import { recognizeLabel } from './ocr.js';

const $ = (sel) => document.querySelector(sel);
const HISTORY_KEY = 'swadeshi-history-v1';

// Everything we know about the product currently being checked. Scanning a
// label after a barcode refines the same product rather than starting over.
let current = {};
let stopScan = null;

// ---------- Tabs ----------
document.querySelectorAll('.tabs button').forEach((btn) =>
  btn.addEventListener('click', () => showTab(btn.dataset.tab)),
);

function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name !== 'barcode') stopCamera();
}

// ---------- Status ----------
function setStatus(msg, isError = false) {
  const el = $('#status');
  el.hidden = !msg;
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

// ---------- Barcode ----------
$('#start-scan').addEventListener('click', async () => {
  setStatus('Point the camera at the barcode…');
  $('#viewfinder').hidden = false;
  $('#start-scan').hidden = true;
  $('#stop-scan').hidden = false;
  stopScan = await startScanner(
    $('#video'),
    (code) => {
      resetCameraUi();
      navigator.vibrate?.(80);
      checkBarcode(code);
    },
    (err) => {
      resetCameraUi();
      setStatus(cameraErrorMessage(err), true);
    },
  );
});

$('#stop-scan').addEventListener('click', stopCamera);

function stopCamera() {
  stopScan?.();
  stopScan = null;
  resetCameraUi();
}

function resetCameraUi() {
  $('#viewfinder').hidden = true;
  $('#start-scan').hidden = false;
  $('#stop-scan').hidden = true;
}

function cameraErrorMessage(err) {
  if (err?.name === 'NotAllowedError') return 'Camera permission was denied. Allow camera access, or upload a photo / type the digits.';
  if (err?.name === 'NotFoundError') return 'No camera found. Upload a photo or type the barcode digits instead.';
  if (!window.isSecureContext) return 'The camera needs HTTPS (or localhost). Upload a photo or type the digits instead.';
  return err?.message || 'Could not start the camera.';
}

$('#barcode-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  setStatus('Looking for a barcode in the photo…');
  try {
    const code = await decodeImageFile(file);
    if (code) checkBarcode(code);
    else setStatus('No barcode found in that photo. Try a closer, sharper shot.', true);
  } catch (err) {
    setStatus(err.message, true);
  }
});

$('#manual-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = cleanCode($('#manual-code').value);
  if (!code) return;
  if (!isValidGtin(code)) {
    setStatus(`"${code}" doesn't look like a valid barcode — check the digits. Checking anyway…`, true);
  }
  checkBarcode(code);
});

async function checkBarcode(code) {
  current = { barcode: cleanCode(code) };
  $('#manual-code').value = current.barcode;
  setStatus(`Barcode ${current.barcode} — looking it up…`);
  render(classify(current)); // instant offline answer
  current.online = await lookupBarcode(current.barcode);
  setStatus(current.online ? '' : 'Product not found online — showing what the barcode alone tells us.');
  finish();
}

// ---------- Label OCR ----------
$('#label-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const progress = $('#ocr-progress');
  progress.hidden = false;
  progress.querySelector('.bar').style.setProperty('--pct', '5%');
  setStatus('Reading the label on your device — this can take a few seconds the first time…');
  try {
    const text = await recognizeLabel(file, (pct) => progress.querySelector('.bar').style.setProperty('--pct', `${pct}%`));
    $('#ocr-text').value = text;
    $('#ocr-details').hidden = false;
    setStatus(text.trim() ? '' : 'No text found — try a sharper, well-lit photo.', !text.trim());
    checkLabelText(text);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    progress.hidden = true;
  }
});

$('#recheck-text').addEventListener('click', () => checkLabelText($('#ocr-text').value));

function checkLabelText(text) {
  current = { ...current, labelText: text };
  finish();
}

// ---------- Brand search ----------
$('#brand-list').append(
  ...[...new Set(BRANDS.map((b) => b.name))].sort().map((n) => Object.assign(document.createElement('option'), { value: n })),
);

$('#search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#brand-input').value.trim();
  if (!q) return;
  checkBrand(q);
});

function checkBrand(q) {
  current = { brandQuery: q };
  setStatus('');
  const result = classify(current);
  if (!result.brand) {
    setStatus(`"${q}" isn't in our brand list yet. Try scanning the label for “Manufactured by” / “Country of Origin”.`, true);
  }
  finish(result);
}

// ---------- Rendering ----------
const TONE = {
  swadeshi: 'good', 'indian-brand': 'good', 'likely-indian': 'good',
  'indian-brand-imported': 'warn', 'made-in-india': 'warn', 'likely-foreign': 'warn',
  foreign: 'bad', 'foreign-brand': 'bad', unknown: 'none',
};

function finish(result = classify(current)) {
  render(result);
  saveHistory(result);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

function render(r) {
  const box = $('#result');
  box.hidden = false;
  const online = current.online;
  const title = online?.productName || r.brand?.name || current.brandQuery || (current.barcode ? `Barcode ${current.barcode}` : 'Label scan');

  box.replaceChildren(
    el('div', { class: `verdict ${TONE[r.verdict]}` },
      el('span', { class: 'emoji', 'aria-hidden': 'true' }, r.emoji),
      el('div', {},
        el('h2', {}, r.label),
        el('p', {}, r.summary),
      ),
    ),
    el('div', { class: 'body' },
      el('div', { class: 'product' },
        online?.image ? el('img', { src: online.image, alt: '' }) : null,
        el('div', {},
          el('div', { class: 'name' }, title),
          el('div', { class: 'meta' },
            [r.brand ? `Brand: ${r.brand.name} · Owner: ${r.brand.owner}` : online?.brands ? `Brand: ${online.brands}` : null]
              .filter(Boolean).join(''),
          ),
          r.confidence !== 'none' ? el('span', { class: 'pill' }, `Confidence: ${r.confidence}`) : null,
        ),
      ),
      r.evidence.length ? [el('h3', {}, 'Why'), el('ul', { class: 'evidence' }, r.evidence.map((e) => el('li', { class: e.direction }, e.text)))] : null,
      r.alternatives.length
        ? [
          el('h3', {}, 'Swadeshi alternatives'),
          el('ul', { class: 'alts' }, r.alternatives.map((a) =>
            el('li', {}, el('button', { type: 'button', title: a.owner, onclick: () => { showTab('search'); $('#brand-input').value = a.name; checkBrand(a.name); } }, a.name)))),
        ]
        : null,
      r.manufacture == null && !current.labelText
        ? el('div', { class: 'refine' },
          el('button', { type: 'button', onclick: () => { showTab('label'); $('#label-file').click(); } }, '🏷️ Scan the label to confirm where it was made'))
        : null,
      online ? el('p', { class: 'hint' }, `Product data: ${online.source}`) : null,
    ),
  );
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- History ----------
function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory(r) {
  const entry = {
    title: current.online?.productName || r.brand?.name || current.brandQuery || current.barcode || 'Label scan',
    emoji: r.emoji,
    label: r.label,
    barcode: current.barcode || null,
    brandQuery: current.brandQuery || r.brand?.name || null,
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
      onclick: () => (h.barcode ? checkBarcode(h.barcode) : h.brandQuery && checkBrand(h.brandQuery)),
    },
    el('span', {}, `${h.emoji} ${h.title} — ${h.label}`),
    el('span', { class: 'when' }, new Date(h.at).toLocaleDateString())))));
}

$('#clear-history').addEventListener('click', () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  renderHistory();
});

renderHistory();

// ---------- Offline support ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
