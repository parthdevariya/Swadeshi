# Swadeshi Scanner 🇮🇳

A mobile web app (installable PWA) that tells you whether a product is **Swadeshi** — owned by an Indian company and made in India — by scanning its barcode, reading its label, or searching the brand.

## How it decides

"Swadeshi" is really two questions, answered separately and then combined:

| | Made in India | Made abroad | Unknown |
|---|---|---|---|
| **Indian-owned brand** | 🇮🇳 Swadeshi | 🟡 Indian brand, made abroad | 🟢 Indian brand |
| **Foreign-owned brand** | 🟠 Made in India, foreign-owned | 🔴 Foreign | 🔴 Foreign brand |
| **Owner unknown** | 🟢 Likely Indian | 🟠 Likely foreign | ❔ Not enough info |

Signals used (every result shows its "Why" list):

1. **Brand ownership** — a curated list (`js/brands.js`) of ~480 brand names mapped to their ultimate owner, with notes for surprising cases (Thums Up → Coca-Cola, MTR → Orkla, Tetley → Tata, Savlon → ITC).
2. **Label text** — on-device OCR (Tesseract.js) looks for *"Country of Origin"*, *"Made in …"*, *"Imported by"* and *"Manufactured by … <Indian address>"*. The photo never leaves the phone.
3. **Online product data** — [Open Food Facts](https://openfoodfacts.org), Open Beauty Facts and Open Products Facts (brand, manufacturing place, origin).
4. **Barcode prefix** — `890` means the company registered with GS1 India. This is a weak signal: it shows where the barcode was issued, not where the product was made.

When the brand is foreign-owned, the app suggests Indian-owned alternatives in the same category.

## Features

- 📷 Live barcode scanning (native `BarcodeDetector`, with ZXing fallback for iPhone/Firefox), photo upload, or typed digits
- 🏷️ Label OCR with editable recognised text
- 🔎 Brand search with autocomplete
- 🕘 Recent-checks history (stored only on the device)
- 📴 Works offline for brand search and barcode-prefix checks
- 🌗 Light and dark mode

## Run locally

No build step and no dependencies.

```sh
npm start        # http://localhost:8080
npm test         # unit tests (Node 18+)
```

The camera only works in a secure context: `localhost` on your computer, or HTTPS. To try it on a phone, deploy the folder to any static HTTPS host — e.g. enable **GitHub Pages** for this repository (Settings → Pages → deploy from branch, root folder).

## Project layout

```
index.html            App shell
css/styles.css        Styles
js/app.js             UI wiring
js/classifier.js      Combines signals into a verdict + alternatives (pure, tested)
js/brands.js          Brand → owner database
js/textParser.js      Origin / manufacturer / brand extraction from text (pure, tested)
js/barcode.js         Check-digit validation and GS1 prefix lookup (pure, tested)
js/lookup.js          Open Food Facts lookups
js/scanner.js         Camera barcode scanning
js/ocr.js             Label OCR
sw.js                 Offline cache
tests/                node:test unit tests
```

## Contributing brand data

Ownership changes through acquisitions, so the brand list needs care:

- Add brands to the right owner group in `js/brands.js` with `I(...)` (Indian-owned) or `F(...)` (foreign-owned).
- Record the **ultimate** owner (e.g. Hindustan Unilever → Unilever).
- Add a `note` when the history is surprising.
- If a brand name is also an everyday word ("Real", "Hit", "Tide"), add it to `AMBIGUOUS_NAMES` so it is not matched in free OCR text.
- Run `npm test` — it checks that no brand name is listed with conflicting ownership.

## Limitations

- Results are guidance, not certification. Always check the "Country of Origin" printed on the pack (mandatory on packaged goods sold in India).
- Coverage of Indian products in Open Food Facts is partial; scanning the label fills the gap.
- Joint ventures and partial stakes are simplified to the controlling owner.
