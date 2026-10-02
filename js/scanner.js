// Camera barcode scanner. Uses the native BarcodeDetector API when available
// (Chrome/Edge on Android, recent desktop Chrome) and lazily loads ZXing as a
// fallback (iOS Safari, Firefox).

const ZXING_URL = 'https://unpkg.com/@zxing/library@0.21.3/umd/index.min.js';
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

let zxingPromise;
function loadZxing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = ZXING_URL;
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => reject(new Error('Could not load the barcode library. Check your connection.'));
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

/**
 * Start scanning into the given <video>. Calls onResult(code) once, then stops.
 * Returns a stop() function.
 */
export async function startScanner(video, onResult, onError) {
  let stopped = false;
  let stream;
  let zxingReader;

  const stop = () => {
    stopped = true;
    zxingReader?.reset();
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  try {
    const detector = await nativeDetector();
    if (detector) {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      video.srcObject = stream;
      await video.play();
      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const value = codes[0].rawValue;
            stop();
            onResult(value);
            return;
          }
        } catch {
          // Frame not ready yet; keep going.
        }
        setTimeout(tick, 150);
      };
      tick();
    } else {
      const ZXing = await loadZxing();
      if (stopped) return stop;
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E,
      ]);
      zxingReader = new ZXing.BrowserMultiFormatReader(hints);
      zxingReader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        video,
        (result) => {
          if (result && !stopped) {
            stop();
            onResult(result.getText());
          }
        },
      );
    }
  } catch (err) {
    stop();
    onError(err);
  }
  return stop;
}

/** Decode a barcode from a still image file (for devices without camera access). */
export async function decodeImageFile(file) {
  const bitmap = await createImageBitmap(file);
  const detector = await nativeDetector();
  if (detector) {
    const codes = await detector.detect(bitmap);
    if (codes.length) return codes[0].rawValue;
  }
  const ZXing = await loadZxing();
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const reader = new ZXing.BrowserMultiFormatReader();
  try {
    const result = await reader.decodeFromImageUrl(canvas.toDataURL('image/png'));
    return result.getText();
  } catch {
    return null;
  }
}
