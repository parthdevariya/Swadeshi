// "Install this app" popup.
//
//   • Android / desktop Chromium (Chrome, Edge, Samsung Internet): capture the
//     browser's beforeinstallprompt event and show our own popup with a real
//     one-tap Install button.
//   • iPhone / iPad: Safari has no install API, so show the two-step
//     "Share → Add to Home Screen" instructions instead.
//   • Other mobile browsers (e.g. Firefox): point to the browser menu.
//
// Never shown when already running as an installed app, and "Not now" snoozes
// it for a few days.

const SNOOZE_KEY = 'swadeshi-install-snoozed-until';
const SNOOZE_DAYS = 3;

export function detectPlatform(nav = navigator) {
  const ua = nav.userAgent || '';
  const iOS = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && (nav.maxTouchPoints || 0) > 1);
  const android = /android/i.test(ua);
  return {
    iOS,
    android,
    mobile: iOS || android || /mobile/i.test(ua),
    // Chromium browsers fire beforeinstallprompt themselves; don't second-guess them.
    chromium: /chrome|chromium|crios|edg|samsungbrowser/i.test(ua) && !/firefox|fxios/i.test(ua),
  };
}

export function isStandalone(win = window) {
  return win.matchMedia?.('(display-mode: standalone)').matches
    || win.matchMedia?.('(display-mode: fullscreen)').matches
    || win.navigator.standalone === true;
}

function snoozed() {
  try {
    return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || 0);
  } catch {
    return false;
  }
}

function snooze() {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
  } catch {
    // ignore
  }
}

/**
 * Which popup to show: 'prompt' (native install available), 'ios',
 * 'menu' (generic browser-menu instructions) or null.
 */
export function chooseInstallMode({ platform, standalone, hasPrompt, isSnoozed }) {
  if (standalone || isSnoozed) return null;
  if (hasPrompt) return 'prompt';
  if (platform.iOS) return 'ios';
  if (platform.mobile && !platform.chromium) return 'menu';
  return null;
}

export function setupInstall({ sheet, headerButton, onInstalled = () => {} }) {
  const platform = detectPlatform();
  let deferred = null;
  let shownMode = null;

  const $ = (sel) => sheet.querySelector(sel);

  function open(mode) {
    shownMode = mode;
    sheet.dataset.mode = mode;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('open'));
    $('.install-primary').focus({ preventScroll: true });
  }

  function close({ remember = true } = {}) {
    if (remember) snooze();
    sheet.classList.remove('open');
    setTimeout(() => (sheet.hidden = true), 250);
    shownMode = null;
  }

  async function install() {
    if (shownMode !== 'prompt' || !deferred) {
      close();
      return;
    }
    const prompt = deferred;
    deferred = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    close({ remember: choice?.outcome !== 'accepted' });
    if (choice?.outcome === 'accepted') headerButton.hidden = true;
  }

  function maybeShow({ force = false } = {}) {
    const mode = chooseInstallMode({
      platform,
      standalone: isStandalone(),
      hasPrompt: !!deferred,
      isSnoozed: !force && snoozed(),
    });
    if (mode && (force || platform.mobile)) open(mode);
    return mode;
  }

  $('.install-primary').addEventListener('click', install);
  $('.install-later').addEventListener('click', () => close());
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) close();
  });

  headerButton.addEventListener('click', () => {
    if (!maybeShow({ force: true })) headerButton.hidden = true;
  });

  // Keep a header "Install" button for people who dismissed the popup.
  const updateHeaderButton = () => {
    headerButton.hidden = isStandalone() || !(deferred || platform.iOS || (platform.mobile && !platform.chromium));
  };

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own, friendlier popup
    deferred = e;
    updateHeaderButton();
    if (!shownMode) setTimeout(() => !shownMode && maybeShow(), 1200);
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    headerButton.hidden = true;
    if (shownMode) close({ remember: false });
    onInstalled();
  });

  updateHeaderButton();
  // iOS and non-Chromium browsers never fire beforeinstallprompt: show the
  // instructions shortly after the first paint instead.
  if (!platform.chromium || platform.iOS) setTimeout(() => !shownMode && maybeShow(), 2500);
}
