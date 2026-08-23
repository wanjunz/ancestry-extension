# Privacy Policy — Ancestry File Downloader

**Last updated: 2026-08-22**

> **Note to whoever is publishing this extension:** Chrome Web Store requires a *publicly hosted* privacy policy URL in the listing form. This file is a draft of that content — you still need to publish it somewhere public (e.g. GitHub Pages, a gist, a personal site) and paste that URL into the Web Store Developer Dashboard's "Privacy practices" tab. This file by itself, sitting in the repo, does not satisfy that requirement.

## Summary

Ancestry File Downloader does not collect, store, or transmit any personal data, browsing history, or file contents to any server. All processing happens locally, inside your own browser.

## What the extension does with data

- **Images**: The extension fetches the Ancestry case-file image(s) you request, directly from Ancestry's own servers, using your existing logged-in session. Images are either saved to your computer via Chrome's normal download mechanism, embedded into a PDF that is then saved to your computer, or both. At no point are images uploaded anywhere or sent to any third party.
- **Job status**: While a download is running, the extension stores a small status object (current page number, start/end range, case name, and whether it's running/done/stopped/errored) in `chrome.storage.local`. This data stays on your device, is never synced to a Google account or any remote server, and is only used to show progress in the extension's own popup.
- **No analytics, no telemetry**: The extension does not use any analytics or telemetry service. It makes no network requests to any domain other than Ancestry's own site (to fetch images) and Chrome's internal download APIs.

## Why each permission is requested

- **`debugger`**: Used internally by the automation library (`playwright-crx`) to programmatically click Ancestry's own "Save" and "Next image" buttons — this is how the extension finds each image's URL, since Ancestry doesn't expose one through a simpler API.
- **`tabs`**: Used only to identify which open tab the extension should read the current page number from and operate on.
- **`downloads`**: Used to trigger each image's download, detect when it completes, and (in PDF-only mode) delete the intermediate JPG after it's been embedded in the PDF.
- **`offscreen`**: Manifest V3 background scripts have no DOM, so an offscreen document is used only to build the PDF (via `pdf-lib`) and create a temporary Blob URL for the final download.
- **`storage`**: Used only for the local job-status object described above.
- **`host_permissions` (Ancestry domains)**: Used only to fetch the image bytes discovered via the download step, so they can be embedded into the PDF.

## Data retention

Nothing is retained by the extension beyond the current job's in-progress status, which is overwritten the next time a job starts. Downloaded images/PDFs are saved to your computer like any other browser download and are governed by your own file system from that point on — the extension has no further access to them.

## Contact

Questions about this policy can be directed to Alyssa Zhou (alyssazhou@college.harvard.edu).
