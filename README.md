# Ancestry File Downloader

A Chrome extension that automates downloading a range of case-file images from Ancestry.com, so you don't have to click "Save" and "Next image" by hand for every page.

## What it does

Open an Ancestry case-file image in Chrome, enter the last image number you want, and pick a mode:

- **Download imgs separately** — saves each page as its own JPG.
- **Download one PDF with all imgs** — combines every page into a single PDF (the intermediate JPGs are discarded).
- **Download imgs separately AND combine into PDF** — does both.

A STOP button cancels an in-progress run; for the PDF modes, whatever pages were already downloaded before stopping are still assembled into a partial PDF.

## How it works

The extension drives the Ancestry viewer itself (clicking "Save" and "Next image", the same way a person would) rather than calling any Ancestry API, since there's no public API for this. It uses [`playwright-crx`](https://github.com/ruifigueira/playwright-crx) (which relies on `chrome.debugger`) to automate those clicks, and [`pdf-lib`](https://github.com/Hopding/pdf-lib) in an offscreen document to assemble the PDF from the images Chrome downloads. See the header comment in `src/background.js` for the full flow.

## Permissions

| Permission | Why |
|---|---|
| `debugger` | Required by `playwright-crx` to automate clicks on the Ancestry page. |
| `tabs` | To identify the active tab the popup should operate on. |
| `downloads` | To trigger, watch, and (in PDF-only mode) clean up per-image downloads, and to save the final PDF. |
| `offscreen` | MV3 service workers have no DOM; an offscreen document is used to build the PDF and create the download's Blob URL. |
| `storage` | Local-only job status (progress, current page, results) so the popup can poll it while a job runs. |
| `host_permissions` (`ancestry.com` domains) | To fetch the discovered image URL into the offscreen document for PDF embedding. |

See `PRIVACY.md` for the full data-handling explanation — no data is collected or sent anywhere outside the user's own browser.

## Building

```
npm install
npm run build
```

Then load `dist/` as an unpacked extension via `chrome://extensions` (enable Developer mode → "Load unpacked").

## Usage

1. Open the Ancestry case-file image you want to start from.
2. Open the extension popup — it reads the current page number automatically.
3. Enter the last image number you want downloaded.
4. Pick a download mode.
