// Camera + barcode reading.
//
// One camera stream serves both jobs: barcodes are detected live on the video,
// and the shutter grabs a still frame for label OCR. Barcode detection uses the
// native BarcodeDetector API when available (Chrome/Edge on Android) and falls
// back to ZXing (iPhone Safari, Firefox), loaded on first use.

const ZXING_URL = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let zxingPromise;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => {
      zxingPromise = null;
      reject(new Error('Could not load the barcode library. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return zxingPromise;
}

async function nativeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const supported = await window.BarcodeDetector.getSupportedFormats();
    const formats = FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new window.BarcodeDetector({ formats }) : null;
  } catch {
    return null;
  }
}

function toCanvas(source, maxSide) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const h = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Returns { detect(source) → Promise<string|null> } where source is a video,
 * canvas, image or ImageBitmap.
 */
export async function createBarcodeReader() {
  const native = await nativeDetector();
  if (native) {
    return {
      async detect(source) {
        try {
          const codes = await native.detect(source);
          return codes[0]?.rawValue ?? null;
        } catch {
          return null;
        }
      },
    };
  }

  const ZXing = await loadZxing();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  return {
    async detect(source) {
      try {
        const canvas = toCanvas(source, 1000);
        const lum = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
        return reader.decode(new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(lum))).getText();
      } catch {
        return null; // NotFoundException: no barcode in this frame
      }
    },
  };
}

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.loopId = 0;
  }

  get running() {
    return !!this.stream;
  }

  async start() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
    // Continuous autofocus where the browser supports it — sharper label photos.
    const track = this.stream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes('continuous')) track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
  }

  stop() {
    this.stopDetecting();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Look for barcodes on the live video until one is found or stopDetecting() is called. */
  detectBarcodes(reader, onCode) {
    const id = ++this.loopId;
    const tick = async () => {
      if (id !== this.loopId || !this.stream) return;
      if (this.video.readyState >= 2) {
        const code = await reader.detect(this.video);
        if (code && id === this.loopId) {
          onCode(code);
          return;
        }
      }
      setTimeout(tick, 200);
    };
    tick();
  }

  stopDetecting() {
    this.loopId++;
  }

  /** Full-resolution still of the current frame. */
  capture() {
    return toCanvas(this.video, 1600);
  }
}

/** Load a user-chosen photo into a canvas. */
export async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  return toCanvas(bitmap, 1600);
}
