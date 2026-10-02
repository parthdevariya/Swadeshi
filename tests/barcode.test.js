import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin, gs1Country, analyzeBarcode } from '../js/barcode.js';

test('validates EAN-13 check digits', () => {
  assert.equal(isValidGtin('8901063010031'), true); // Britannia
  assert.equal(isValidGtin('8901063010032'), false);
  assert.equal(isValidGtin('4006381333931'), true);
  assert.equal(isValidGtin('12345'), false);
});

test('validates UPC-A and EAN-8', () => {
  assert.equal(isValidGtin('036000291452'), true);
  assert.equal(isValidGtin('96385074'), true);
});

test('maps GS1 prefixes to registration countries', () => {
  assert.equal(gs1Country('8901063010031'), 'India');
  assert.equal(gs1Country('6901234567892'), 'China');
  assert.equal(gs1Country('4006381333931'), 'Germany');
  assert.equal(gs1Country('036000291452'), 'United States / Canada');
  assert.equal(gs1Country('9781234567897'), null); // ISBN
  assert.equal(gs1Country('2001234567893'), null); // in-store
});

test('analyzeBarcode flags Indian prefix', () => {
  assert.equal(analyzeBarcode('890 1063 010031').isIndianPrefix, true);
});
