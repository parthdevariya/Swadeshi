import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, chooseInstallMode } from '../js/install.js';

const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  iPhoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  iPhoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
  iPadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  desktopChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
};
const p = (ua, maxTouchPoints = 0) => detectPlatform({ userAgent: ua, maxTouchPoints });
const mode = (platform, extra = {}) => chooseInstallMode({ platform, standalone: false, hasPrompt: false, isSnoozed: false, ...extra });

test('detects platforms', () => {
  assert.equal(p(UA.iPhoneSafari).iOS, true);
  assert.equal(p(UA.iPhoneChrome).iOS, true);
  assert.equal(p(UA.iPadDesktopMode, 5).iOS, true); // iPadOS pretends to be a Mac
  assert.equal(p(UA.iPadDesktopMode, 0).iOS, false); // a real Mac
  assert.equal(p(UA.androidChrome).chromium, true);
  assert.equal(p(UA.androidFirefox).chromium, false);
});

test('native prompt wins when the browser offers one', () => {
  assert.equal(mode(p(UA.androidChrome), { hasPrompt: true }), 'prompt');
});

test('iPhone gets Add-to-Home-Screen instructions in any browser', () => {
  assert.equal(mode(p(UA.iPhoneSafari)), 'ios');
  assert.equal(mode(p(UA.iPhoneChrome)), 'ios');
});

test('non-Chromium Android gets browser-menu instructions', () => {
  assert.equal(mode(p(UA.androidFirefox)), 'menu');
});

test('nothing when Chrome has not offered install (e.g. already installed) or on desktop without a prompt', () => {
  assert.equal(mode(p(UA.androidChrome)), null);
  assert.equal(mode(p(UA.desktopChrome)), null);
});

test('never when running as an installed app or snoozed', () => {
  assert.equal(mode(p(UA.iPhoneSafari), { standalone: true }), null);
  assert.equal(mode(p(UA.androidChrome), { hasPrompt: true, isSnoozed: true }), null);
});
