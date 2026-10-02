# Swadeshi Scanner 🇮🇳

A mobile web app (installable PWA) that tells you whether a product is **Swadeshi** — owned by an Indian company and made in India.

**One tap and you're scanning.** Point the camera at anything:

- a **barcode** is read automatically, no button needed;
- no barcode? Tap the shutter and the app **reads the label or front of pack** (on-device OCR);
- it then **researches the brand online** — who owns it, which country they're in, and a short background — using free, open sources.

Everything is free: no account, no API keys, no paid AI services.

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

- 📷 One camera for everything: live barcode detection + shutter for label OCR (native `BarcodeDetector`, ZXing fallback for iPhone/Firefox)
- ⚡ OCR engine pre-loads while you aim, so the first label read is quick; step-by-step progress while it works
- 🏷️ Editable recognised text with re-check
- 🌐 Free web research (Wikidata ownership chain + Wikipedia background)
- 💾 Self-growing brand list: unknown brands are researched once, then saved on the device and recognised instantly next time (also from the pack's big brand text)
- 📤 "Suggest for everyone" opens a pre-filled GitHub issue with the ready-to-paste `brands.js` line, so the shared list can grow too
- 🖼️ Pick a photo from the gallery instead of using the camera
- 🔎 Brand search with autocomplete
- 🕘 Recent-checks history (stored only on the device)
- 📴 Works offline for brand search and barcode-prefix checks
- 📲 Installable app with an install popup (Android one-tap install, iPhone step-by-step)
- 🌗 Light and dark mode

## Use it on your phone

The app is published with GitHub Pages: open the link on your phone and an **install popup** appears.

- **Android (Chrome, Edge, Samsung Internet):** tap **Install** — it's added to the home screen and app drawer like a normal app.
- **iPhone / iPad:** the popup shows the two steps — **Share** → **Add to Home Screen**.
- Missed the popup? Tap **⬇️ Install app** at the top. "Not now" hides the popup for 3 days.

Once installed it opens full-screen, straight to the scanner, and works offline (brand list, saved brands, history). Long-press the icon on Android for a **Scan a product** shortcut.

### Publishing (one-time setup)

1. On GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to the default branch (or run the **deploy** workflow from the Actions tab).
3. The app goes live at `https://<owner>.github.io/<repo>/` — for this repo, `https://parthdevariya.github.io/Swadeshi/`.

The `deploy` workflow runs the tests first and only publishes if they pass. Any other static HTTPS host (Netlify, Vercel, Cloudflare Pages) works too — upload `index.html`, `manifest.webmanifest`, `sw.js`, `css/`, `js/` and `icons/`.

## Run locally

No build step and no dependencies.

```sh
npm start        # http://localhost:8080
npm test         # unit tests (Node 18+)
```

The camera and installing both need a secure context: `localhost` on your computer, or HTTPS (see *Publishing* above) on a phone.

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
js/webLookup.js       Wikidata ownership chain + Wikipedia summary (pure, tested)
js/learnedBrands.js   Brands learned from the web, saved on the device (tested)
js/install.js         Install popup: native prompt on Android, steps on iPhone (tested)
js/scanner.js         Camera stream, live barcode detection, frame capture
js/ocr.js             On-device label OCR (Tesseract.js, sparse-text mode)
manifest.webmanifest  App name, icons, shortcut, screenshot for the install sheet
icons/                App icons (SVG source + PNG sizes for Android/iOS)
sw.js                 Offline cache
tests/                node:test unit tests
```

## Contributing brand data

### From the app

When the app learns a brand from Wikidata it shows **📤 Suggest for everyone**. That opens a GitHub issue (label `brand-suggestion`) with the owner, country, Wikidata link and the exact line to paste into `js/brands.js`. A maintainer checks it and adds it to the curated list, which then ships to every user. Saved brands can be reviewed or removed under **My saved brands**.

### By hand

Ownership changes through acquisitions, so the brand list needs care:

- Add brands to the right owner group in `js/brands.js` with `I(...)` (Indian-owned) or `F(...)` (foreign-owned).
- Record the **ultimate** owner (e.g. Hindustan Unilever → Unilever).
- Add a `note` when the history is surprising.
- If a brand name is also an everyday word ("Real", "Hit", "Tide"), add it to `AMBIGUOUS_NAMES` so it is not matched in free OCR text.
- Run `npm test` — it checks that no brand name is listed with conflicting ownership.

## Limitations

- Results are guidance, not certification. Always check the "Country of Origin" printed on the pack (mandatory on packaged goods sold in India).
- Coverage of Indian products in Open Food Facts is partial; scanning the label fills the gap.
- Saved brands live on each phone (browser storage); there is no shared server, so they reach other users only through the curated list.
- Wikidata is community-edited: smaller brands may be missing, and ownership data can lag behind recent deals. The curated list always takes priority.
- OCR works best on flat, well-lit, in-focus text in English.
- Joint ventures and partial stakes are simplified to the controlling owner.
