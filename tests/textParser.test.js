import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findOriginCountries, hasImporterStatement, hasIndianManufacturer, findBrands, normalizeText } from '../js/textParser.js';

test('repairs common OCR confusions in "India"', () => {
  assert.equal(normalizeText('Made in lNDlA'), 'made in india');
});

test('finds country of origin statements', () => {
  assert.deepEqual(findOriginCountries('Country of Origin: India'), ['India']);
  assert.deepEqual(findOriginCountries('MADE IN CHINA'), ['China']);
  assert.deepEqual(findOriginCountries('Product of U.S.A.'), ['United States']);
  assert.deepEqual(findOriginCountries('Net wt 100g'), []);
});

test('detects importer statements', () => {
  assert.equal(hasImporterStatement('Imported & Marketed by: XYZ Pvt Ltd, Mumbai'), true);
  assert.equal(hasImporterStatement('Manufactured by ABC'), false);
});

test('detects Indian manufacturer addresses', () => {
  assert.equal(hasIndianManufacturer('Mfd. by: Parle Products Pvt. Ltd., Vile Parle (E), Mumbai 400057'), true);
  assert.equal(hasIndianManufacturer('Manufactured by: Acme Co, Shenzhen. Marketed by XYZ, Mumbai'), false);
});

test('finds brands, longest name first, without double-counting', () => {
  assert.deepEqual(findBrands('Maruti Suzuki Swift').map((b) => b.name), ['Maruti Suzuki']);
  assert.deepEqual(findBrands('Nescafé Classic').map((b) => b.owner), ['Nestlé']);
});

test('ignores ambiguous everyday words in free text but not in brand fields', () => {
  assert.deepEqual(findBrands('a real treat for kids'), []);
  assert.equal(findBrands('Real', { structured: true })[0].owner, 'Dabur India');
});

test('word boundaries prevent partial matches', () => {
  assert.deepEqual(findBrands('Amulya'), []);
});
