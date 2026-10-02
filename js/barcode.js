// Barcode helpers: validation and GS1 prefix → country of registration.
//
// Important caveat surfaced to users: a GS1 prefix tells you which national GS1
// office issued the company's barcode number, NOT where the product was made.
// "890" means the brand owner registered with GS1 India, which is a useful
// signal but not proof of Indian manufacture or ownership.

const GS1_RANGES = [
  [0, 19, 'United States / Canada'],
  [30, 39, 'United States'],
  [60, 99, 'United States / Canada'],
  [300, 379, 'France'],
  [380, 380, 'Bulgaria'],
  [383, 383, 'Slovenia'],
  [385, 385, 'Croatia'],
  [400, 440, 'Germany'],
  [450, 459, 'Japan'],
  [460, 469, 'Russia'],
  [471, 471, 'Taiwan'],
  [480, 480, 'Philippines'],
  [489, 489, 'Hong Kong'],
  [490, 499, 'Japan'],
  [500, 509, 'United Kingdom'],
  [520, 521, 'Greece'],
  [528, 528, 'Lebanon'],
  [529, 529, 'Cyprus'],
  [539, 539, 'Ireland'],
  [540, 549, 'Belgium / Luxembourg'],
  [560, 560, 'Portugal'],
  [569, 569, 'Iceland'],
  [570, 579, 'Denmark'],
  [590, 590, 'Poland'],
  [594, 594, 'Romania'],
  [599, 599, 'Hungary'],
  [600, 601, 'South Africa'],
  [608, 608, 'Bahrain'],
  [609, 609, 'Mauritius'],
  [611, 611, 'Morocco'],
  [613, 613, 'Algeria'],
  [616, 616, 'Kenya'],
  [619, 619, 'Tunisia'],
  [621, 621, 'Syria'],
  [622, 622, 'Egypt'],
  [624, 624, 'Libya'],
  [625, 625, 'Jordan'],
  [626, 626, 'Iran'],
  [627, 627, 'Kuwait'],
  [628, 628, 'Saudi Arabia'],
  [629, 629, 'United Arab Emirates'],
  [640, 649, 'Finland'],
  [690, 699, 'China'],
  [700, 709, 'Norway'],
  [729, 729, 'Israel'],
  [730, 739, 'Sweden'],
  [740, 745, 'Central America'],
  [750, 750, 'Mexico'],
  [754, 755, 'Canada'],
  [759, 759, 'Venezuela'],
  [760, 769, 'Switzerland'],
  [770, 771, 'Colombia'],
  [773, 773, 'Uruguay'],
  [775, 775, 'Peru'],
  [777, 777, 'Bolivia'],
  [779, 779, 'Argentina'],
  [780, 780, 'Chile'],
  [784, 784, 'Paraguay'],
  [786, 786, 'Ecuador'],
  [789, 790, 'Brazil'],
  [800, 839, 'Italy'],
  [840, 849, 'Spain'],
  [850, 850, 'Cuba'],
  [858, 858, 'Slovakia'],
  [859, 859, 'Czech Republic'],
  [860, 860, 'Serbia'],
  [865, 865, 'Mongolia'],
  [867, 867, 'North Korea'],
  [868, 869, 'Turkey'],
  [870, 879, 'Netherlands'],
  [880, 880, 'South Korea'],
  [883, 883, 'Myanmar'],
  [884, 884, 'Cambodia'],
  [885, 885, 'Thailand'],
  [888, 888, 'Singapore'],
  [890, 890, 'India'],
  [893, 893, 'Vietnam'],
  [896, 896, 'Pakistan'],
  [899, 899, 'Indonesia'],
  [900, 919, 'Austria'],
  [930, 939, 'Australia'],
  [940, 949, 'New Zealand'],
  [955, 955, 'Malaysia'],
  [958, 958, 'Macau'],
];

/** Strip everything but digits. */
export function cleanCode(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Validate the GS1 check digit of an EAN-8, UPC-A (12), EAN-13 or GTIN-14. */
export function isValidGtin(raw) {
  const code = cleanCode(raw);
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop();
  let sum = 0;
  // Weights alternate 3,1,3,1… starting from the digit next to the check digit.
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i] * w;
  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Return the GS1 registration country for a barcode, or null when it cannot
 * be determined (EAN-8, restricted/in-store ranges, unknown prefixes).
 */
export function gs1Country(raw) {
  let code = cleanCode(raw);
  if (code.length === 12) code = '0' + code; // UPC-A is EAN-13 with a leading 0
  if (code.length === 14) code = code.slice(1); // drop GTIN-14 packaging indicator
  if (code.length !== 13) return null;
  const prefix = Number(code.slice(0, 3));
  if (prefix >= 200 && prefix <= 299) return null; // in-store / restricted circulation
  if (prefix === 977 || prefix === 978 || prefix === 979) return null; // ISSN / ISBN
  const hit = GS1_RANGES.find(([lo, hi]) => prefix >= lo && prefix <= hi);
  return hit ? hit[2] : null;
}

export function analyzeBarcode(raw) {
  const code = cleanCode(raw);
  return {
    code,
    valid: isValidGtin(code),
    gs1Country: gs1Country(code),
    isIndianPrefix: gs1Country(code) === 'India',
  };
}
