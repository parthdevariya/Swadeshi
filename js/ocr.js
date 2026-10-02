// On-device OCR with Tesseract.js — free, no account, and the photo never
// leaves the phone. The English model (~10 MB) downloads once and is cached.

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise;

function loadScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Could not load the text-recognition library. Check your connection.'));
    document.head.appendChild(s);
  });
}

let progressCb = () => {};

/** Start downloading the OCR engine in the background so the first scan is fast. */
export function warmUpOcr() {
  workerPromise ??= loadScript()
    .then((T) => T.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') progressCb(Math.round(m.progress * 100));
      },
    }))
    .then(async (worker) => {
      // Packaging text is scattered in blocks of very different sizes; "sparse
      // text" mode finds big brand names that the default page layout skips.
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      return worker;
    })
    .catch((err) => {
      workerPromise = null;
      throw err;
    });
  return workerPromise;
}

/** Grayscale + contrast boost; helps on glossy, colourful packaging. */
function preprocess(canvas) {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext('2d');
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(canvas, 0, 0);
  return out;
}

/**
 * Read text from a canvas. Returns { text, headline } where headline is the
 * line set in the largest type — on the front of a pack that's usually the brand.
 */
export async function readText(canvas, onProgress = () => {}) {
  const worker = await warmUpOcr();
  progressCb = onProgress;
  try {
    const { data } = await worker.recognize(preprocess(canvas));
    return { text: data.text || '', headline: pickHeadline(data.lines || []) };
  } finally {
    progressCb = () => {};
  }
}

export function pickHeadline(lines) {
  const candidates = lines
    .map((l) => ({ text: l.text.replace(/[^A-Za-z0-9&' -]/g, ' ').replace(/\s+/g, ' ').trim(), h: l.bbox.y1 - l.bbox.y0, conf: l.confidence }))
    .filter((l) => l.conf > 55 && /[A-Za-z]{3}/.test(l.text) && l.text.length <= 40);
  candidates.sort((a, b) => b.h - a.h);
  return candidates[0]?.text || null;
}
