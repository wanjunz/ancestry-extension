# Chrome Web Store submission checklist

Draft text for the Developer Dashboard's listing and review forms. Copy/paste and adjust as needed — this isn't submitted anywhere automatically.

## Package to upload

Zip the contents of `dist/` (after running `npm run build`) — not the repo root. `dist/` should contain: `background.js`, `manifest.json`, `offscreen.html`, `offscreen.js`, `popup.html`, `popup.js`, `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `logo.png`. Do **not** include `node_modules`, `.git`, or `.DS_Store`.

## Store listing icon

Upload `public/icon128.png` (also bundled into `dist/`) as the 128×128 store listing icon in the dashboard's listing form.

## Privacy practices tab

- **Single purpose description**: "This extension automates downloading a user-specified range of case-file images from Ancestry.com, either as individual JPGs, a combined PDF, or both."
- **Privacy policy URL**: paste the public URL where you've hosted the content of `PRIVACY.md` (GitHub Pages, a gist, etc. — this repo file alone doesn't count as "hosted").
- **Permission justifications** (paste one per permission in the form):
  - `debugger`: "Used by the bundled `playwright-crx` automation library to programmatically click Ancestry's own 'Save' and 'Next image' buttons — this is the only way the extension can discover each image's download URL, since Ancestry doesn't expose one through any simpler API."
  - `tabs`: "Used only to identify the active tab so the extension can read the currently-displayed Ancestry page number and know which tab to operate on."
  - `downloads`: "Used to trigger each image's download, detect completion, and (in PDF-only mode) remove the intermediate JPG after it has been embedded in the combined PDF; also used to save the final PDF."
  - `offscreen`: "Manifest V3 background scripts have no DOM. An offscreen document is used solely to assemble the PDF (via `pdf-lib`) and create a Blob URL for the final download."
  - `storage`: "Used only to store a local, transient job-status object (current page, progress, done/error state) so the popup can display progress. Never synced or transmitted."
  - `host_permissions` (`https://ancestry.com/*`, `https://*.ancestry.com/*`): "Used to fetch the image bytes discovered via the download step so they can be embedded into the PDF in the offscreen document."
- **Data usage disclosures**: no data is collected, sold, or transferred to third parties. No personally identifiable information, health information, financial information, authentication credentials, or browsing history is collected. (Confirm these checkboxes match `PRIVACY.md`.)

## Before submitting — verify live

The `host_permissions` were narrowed from `https://*/*` to Ancestry-only domains based on static analysis (the code never hardcodes the image-serving domain; it discovers it at runtime from whatever Chrome download fires). **Run a real "combine" or "both" job against an actual Ancestry case before submitting** to confirm the image fetch inside `src/offscreen.js` still succeeds — if Ancestry serves images from a domain that isn't a `*.ancestry.com` subdomain, this fetch will fail with a permissions error and `host_permissions` will need an additional entry for that domain.

## Version

`manifest.json` is at `1.0.0`, matching `package.json`, for this first public release.
