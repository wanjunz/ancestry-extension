/*
 * Architecture:
 *   popup.js (UI) --STARTJOB/READPAGE--> background.js (this file,
 *   the service worker) --drives the page via playwright-crx-->
 *   Ancestry's tab, and --RESET/ADDIMAGE/FINALIZE--> offscreen.js.
 *
 *   The offscreen document exists because MV3 service workers have
 *   no DOM, so they can't build a PDF (pdf-lib) or create Blob URLs
 *   themselves. chrome.offscreen gives us a DOM-capable context to
 *   do that work in.
 *
 *   `mode` controls what a job actually produces:
 *     "separate" - download each image as a JPG only, no PDF.
 *     "combine"  - produce only the combined PDF.
 *     "both"     - the original behavior: JPGs and the PDF.
 *
 *   Every mode discovers an image's URL the same way: by clicking
 *   Ancestry's own Save UI and observing the resulting native
 *   Chrome download (there is no simpler API to fetch the image
 *   directly). That's why "combine" still triggers a real per-image
 *   download - it then deletes the JPG once it's embedded in the
 *   PDF, since there's no way to get the URL without it.
 */
import {
  crx,
  expect
} from "playwright-crx/test";

/*
 * Only one Playwright session/offscreen document can usefully run
 * at a time, so this simple flag is enough to reject a second
 * START_JOB while one is already in flight.
 */
let jobRunning = false;

/*
 * Set by STOP_JOB while a job is running. The main loop in
 * runDownloadJob() checks this once per iteration (between pages,
 * not mid-download) and breaks out early if it's true.
 */
let stopRequested = false;

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    if (message?.target !== "background") {
      return;
    }

    if (message.type === "READ_PAGE") {

      readPageNumber(message.tabId)
        .then(pageNumber => {
          sendResponse({
            ok: true,
            pageNumber
          });
        })
        .catch(error => {
          sendResponse({
            ok: false,
            error: error.message
          });
        });

      // Keep the message channel open for the async sendResponse above.
      return true;
    }

    if (message.type === "START_JOB") {

      if (jobRunning) {
        sendResponse({
          ok: false,
          error: "A download job is already running."
        });

        return;
      }

      jobRunning = true;
      stopRequested = false;

      /*
       * Acknowledge immediately that the job started - the popup
       * doesn't wait on this message for progress/completion. It
       * instead polls chrome.storage.local (see setStatus) and the
       * badge text, since the job can run far longer than a single
       * message round-trip should be held open for.
       */
      sendResponse({
        ok: true
      });

      runDownloadJob({
        tabId: message.tabId,
        endPage: Number(message.endPage),
        caseName: message.caseName,
        mode: message.mode
      })
        .catch(async error => {

          console.error(
            "Ancestry download failed:",
            error
          );

          await setStatus({
            state: "error",
            message: error.message
          });

          await chrome.action.setBadgeText({
            text: "!"
          });

        })
        .finally(() => {
          jobRunning = false;
        });

      return;
    }

    if (message.type === "STOP_JOB") {

      if (!jobRunning) {
        sendResponse({
          ok: false,
          error: "No download job is running."
        });

        return;
      }

      stopRequested = true;

      sendResponse({
        ok: true
      });

      return;
    }
  }
);

async function readPageNumber(tabId) {

  const crxApp =
    await crx.start();

  let page;

  try {

    page =
      await crxApp.attach(tabId);

    const pageNumberInput =
      page.getByRole(
        "textbox",
        { name: "Page number" }
      );

    return await pageNumberInput.inputValue({
      timeout: 10000
    });

  } finally {

    /*
     * Unconditional cleanup: if inputValue() above threw (e.g. the
     * page navigated away), we still want to detach/close rather
     * than leak this Playwright session.
     */
    if (page) {
      try {
        await crxApp.detach(page);
      } catch {
        // Ignore detach failure.
      }
    }

    await crxApp.close();
  }
}

async function runDownloadJob({
  tabId,
  endPage,
  caseName,
  mode
}) {

  // See the mode summary at the top of this file: only "separate"
  // skips the offscreen document and the PDF entirely.
  const buildsPdf = mode !== "separate";

  const safeCaseName =
    sanitizeFilename(caseName);

  await setStatus({
    state: "starting"
  });

  await chrome.action.setBadgeText({
    text: "..."
  });

  if (buildsPdf) {

    await ensureOffscreenDocument();

    const resetResponse =
      await sendToOffscreen({
        type: "RESET"
      });

    if (!resetResponse?.ok) {
      throw new Error(
        resetResponse?.error ||
        "Could not initialize PDF builder."
      );
    }
  }

  const crxApp =
    await crx.start({
      slowMo: 100
    });

  let page;

  try {

    page =
      await crxApp.attach(tabId);

    const saveButton =
      page.getByRole(
        "button",
        { name: "Save" }
      );

    const downloadButton =
      page.getByRole(
        "button",
        { name: "Save to your computer" }
      );

    const nextButton =
      page.getByRole(
        "button",
        { name: "Next image" }
      ).first();

    const pageNumberInput =
      page.getByRole(
        "textbox",
        { name: "Page number" }
      );

    const startText =
      await pageNumberInput.inputValue();

    const startPage =
      Number(startText);

    if (!Number.isInteger(startPage)) {
      throw new Error(
        `Could not read starting image number: ${startText}`
      );
    }

    if (!Number.isInteger(endPage)) {
      throw new Error(
        "The ending image number is invalid."
      );
    }

    if (endPage < startPage) {
      throw new Error(
        `Ending image ${endPage} is before ` +
        `starting image ${startPage}.`
      );
    }

    let stoppedEarly = false;
    let embeddedCount = 0;
    let lastImageNumber = null;

    for (
      let imageNumber = startPage;
      imageNumber <= endPage;
      imageNumber++
    ) {

      if (stopRequested) {
        stoppedEarly = true;
        break;
      }

      const currentValue =
        Number(
          await pageNumberInput.inputValue()
        );

      if (currentValue !== imageNumber) {
        throw new Error(
          `Expected image ${imageNumber}, ` +
          `but Ancestry shows ${currentValue}.`
        );
      }

      await setStatus({
        state: "running",
        start: startPage,
        end: endPage,
        current: imageNumber,
        caseName: safeCaseName
      });

      await chrome.action.setBadgeText({
        text: String(imageNumber)
      });

      console.log(
        `Downloading image ${imageNumber}...`
      );
        /*
         * Start listening BEFORE clicking the download
         * button so we cannot miss Chrome's download event.
         */
        const chromeDownloadPromise =
          waitForNextChromeDownload(30000);

        await saveButton.click();

        await expect(
          downloadButton
        ).toBeVisible({
          timeout: 5000
        });

        await downloadButton.click();

        /*
         * We deliberately use Chrome's native download
         * event rather than Playwright's "download" event.
         */
        const chromeDownload =
          await chromeDownloadPromise;

        if (!chromeDownload) {
          throw new Error(
            `Chrome did not detect a download ` +
            `for image ${imageNumber}.`
          );
        }

        console.log(
          `Chrome started download ${chromeDownload.id}`,
          chromeDownload.url
        );

        /*
         * Wait until the file has completely downloaded.
         */
        await waitForChromeDownloadComplete(
          chromeDownload.id,
          120000
        );

        /*
         * Re-query Chrome now that the download is done.
         * This gives us the final URL after redirects.
         *
         * This is the only way this code has to learn the image's
         * fetchable URL - Ancestry doesn't expose it any other way
         * we could find (e.g. as a plain <img src>). That's why
         * even "combine" mode, which doesn't want to keep the JPG,
         * still has to go through a real download to discover it.
         */
        const finishedDownloads =
          await chrome.downloads.search({
            id: chromeDownload.id
          });

        const finishedDownload =
          finishedDownloads[0];

        if (!finishedDownload) {
          throw new Error(
            `Could not find completed download ` +
            `for image ${imageNumber}.`
          );
        }

        console.log(
          "Completed download:",
          finishedDownload
        );

        const imageUrl =
          finishedDownload.finalUrl ||
          finishedDownload.url;

        if (!imageUrl) {
          throw new Error(
            `No image URL was available for ` +
            `image ${imageNumber}.`
          );
        }

        if (buildsPdf) {

          /*
           * The image has already been downloaded normally
           * by Ancestry. Now fetch the same image into our
           * offscreen document so it can be added to the PDF.
           */
          const addResponse =
            await sendToOffscreen({
              type: "ADD_IMAGE",
              pageNumber: imageNumber,
              filename:
                finishedDownload.filename,
              url: imageUrl
            });

          if (!addResponse?.ok) {
            throw new Error(
              addResponse?.error ||
              `Could not add image ${imageNumber} ` +
              `to the PDF.`
            );
          }

          embeddedCount++;

          console.log(
            `Added image ${imageNumber} to PDF.`
          );
        }

      /*
       * "combine" mode only wants the final PDF, not the
       * individual JPGs Ancestry's Save button just wrote
       * to disk in order for us to discover the image URL.
       * Now that the image is embedded in the PDF, delete that
       * JPG from disk - there's no way to avoid the download
       * happening in the first place (see the comment above),
       * only to clean it up afterward.
       *
       * The entry deliberately stays in Chrome's download
       * history (not erased) so it's easy to check afterward
       * which images were actually downloaded/skipped if
       * something goes wrong.
       */
      if (mode === "combine") {

        try {
          await chrome.downloads.removeFile(
            chromeDownload.id
          );
        } catch (error) {
          console.warn(
            `Could not remove intermediate JPG for ` +
            `image ${imageNumber}:`,
            error
          );
        }
      }

      console.log(
        `Finished image ${imageNumber}.`
      );

      lastImageNumber = imageNumber;

      /*
       * Stop here on the final image.
       */
      if (imageNumber === endPage) {
        break;
      }

      /*
       * Move to the next image and verify the page number
       * changes before continuing.
       */
      const expectedNext =
        String(imageNumber + 1);

      await nextButton.click();

      await expect(
        pageNumberInput
      ).toHaveValue(
        expectedNext,
        {
          timeout: 20000
        }
      );
    }

    let pdfName;

    /*
     * If STOP was pressed before any page was embedded, there's no
     * partial PDF to build - skip straight to reporting "stopped".
     */
    if (buildsPdf && embeddedCount > 0) {

      /*
       * Build the final PDF. If stoppedEarly, this only contains
       * the pages that were embedded before the stop request.
       */
      const lastPageInPdf =
        stoppedEarly ? lastImageNumber : endPage;

      await setStatus({
        state: "running",
        start: startPage,
        end: endPage,
        current: lastPageInPdf,
        message: "Building PDF..."
      });

      await chrome.action.setBadgeText({
        text: "PDF"
      });

      const finalResponse =
        await sendToOffscreen({
          type: "FINALIZE"
        });

      if (!finalResponse?.ok) {
        throw new Error(
          finalResponse?.error ||
          "Could not create the PDF."
        );
      }

      pdfName =
        `${safeCaseName}_${startPage}-${lastPageInPdf}.pdf`;

      const pdfDownloadId =
        await chrome.downloads.download({
          url: finalResponse.blobUrl,
          filename: pdfName,
          saveAs: false,
          conflictAction: "overwrite"
        });

      await waitForChromeDownloadComplete(
        pdfDownloadId,
        180000
      );

      await sendToOffscreen({
        type: "REVOKE_URL",
        url: finalResponse.blobUrl
      });
    }

    await setStatus({
      state: stoppedEarly ? "stopped" : "done",
      start: startPage,
      end: endPage,
      current: stoppedEarly ? lastImageNumber : endPage,
      pdfName,
      caseName: safeCaseName
    });

    await chrome.action.setBadgeText({
      text: stoppedEarly ? "STOP" : "OK"
    });

    console.log(
      stoppedEarly ?
        (pdfName ?
          `Stopped: ${pdfName}` :
          `Stopped at image ${lastImageNumber}`) :
        (pdfName ?
          `Done: ${pdfName}` :
          `Done: images ${startPage}-${endPage}`)
    );

  } finally {

    if (page) {
      try {
        await crxApp.detach(page);
      } catch (error) {
        console.warn(
          "Could not detach Playwright:",
          error
        );
      }
    }

    try {
      await crxApp.close();
    } catch {
      // Ignore.
    }

    /*
     * Closing the offscreen document releases its in-memory
     * pdfDoc. Always attempted, even in "separate" mode where
     * one was never opened - closeDocument() just throws (caught
     * below) if there's nothing to close.
     */
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      // It may already be closed.
    }
  }
}

async function ensureOffscreenDocument() {

  const offscreenUrl =
    chrome.runtime.getURL(
      "offscreen.html"
    );

  // Chrome allows only one offscreen document per extension at a
  // time; calling createDocument() while one already exists throws.
  const contexts =
    await chrome.runtime.getContexts({
      contextTypes: [
        "OFFSCREEN_DOCUMENT"
      ],
      documentUrls: [
        offscreenUrl
      ]
    });

  if (contexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [
      "BLOBS"
    ],
    justification:
      "Build a PDF and create Blob URLs for downloaded case images."
  });
}

async function sendToOffscreen(message) {

  return await chrome.runtime.sendMessage({
    target: "offscreen",
    ...message
  });
}

function waitForNextChromeDownload(
  timeoutMs
) {

  return new Promise(resolve => {

    let finished = false;

    const listener = item => {

      if (finished) {
        return;
      }

      finished = true;

      clearTimeout(timer);

      chrome.downloads.onCreated
        .removeListener(listener);

      resolve(item);
    };

    chrome.downloads.onCreated
      .addListener(listener);

    const timer =
      setTimeout(() => {

        if (finished) {
          return;
        }

        finished = true;

        chrome.downloads.onCreated
          .removeListener(listener);

        resolve(null);

      }, timeoutMs);
  });
}

async function waitForChromeDownloadComplete(
  downloadId,
  timeoutMs
) {

  const existing =
    await chrome.downloads.search({
      id: downloadId
    });

  if (
    existing[0]?.state === "complete"
  ) {
    return;
  }

  if (
    existing[0]?.state === "interrupted"
  ) {
    throw new Error(
      `Chrome download ${downloadId} was interrupted.`
    );
  }

  return await new Promise(
    (resolve, reject) => {

      const listener = delta => {

        if (delta.id !== downloadId) {
          return;
        }

        if (
          delta.state?.current ===
          "complete"
        ) {
          cleanup();
          resolve();
        }

        if (
          delta.state?.current ===
          "interrupted"
        ) {
          cleanup();

          reject(
            new Error(
              `Chrome download ${downloadId} was interrupted.`
            )
          );
        }
      };

      const timer =
        setTimeout(() => {

          cleanup();

          reject(
            new Error(
              `Timed out waiting for download ${downloadId}.`
            )
          );

        }, timeoutMs);

      function cleanup() {
        clearTimeout(timer);

        chrome.downloads.onChanged
          .removeListener(listener);
      }

      chrome.downloads.onChanged
        .addListener(listener);
    }
  );
}


function sanitizeFilename(value) {

  const cleaned =
    String(value || "Ancestry Case")
      .trim()
      // Strip characters illegal in filenames on Windows/macOS.
      .replace(
        /[<>:"/\\|?*\x00-\x1F]/g,
        "-"
      )
      .replace(/\.+$/g, "")
      .slice(0, 120);

  return cleaned || "Ancestry Case";
}

async function setStatus(status) {

  await chrome.storage.local.set({
    ancestryJob: status
  });
}

