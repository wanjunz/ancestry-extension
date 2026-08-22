import {
  crx,
  expect
} from "playwright-crx/test";

let jobRunning = false;

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

      sendResponse({
        ok: true
      });

      runDownloadJob({
        tabId: message.tabId,
        endPage: Number(message.endPage),
        caseName: message.caseName
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
  caseName
}) {

  const safeCaseName =
    sanitizeFilename(caseName);

  await setStatus({
    state: "starting"
  });

  await chrome.action.setBadgeText({
    text: "..."
  });

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

    for (
      let imageNumber = startPage;
      imageNumber <= endPage;
      imageNumber++
    ) {

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

        console.log(
          `Added image ${imageNumber} to PDF.`
        );
        


      /*
       * Normally Ancestry's own Save button will already
       * create a regular Chrome download.
       *
       * If Chrome reports that download, wait for it.
       * Otherwise save our captured copy explicitly.
       */
      if (chromeDownload) {

        await waitForChromeDownloadComplete(
          chromeDownload.id,
          120000
        );

        await sendToOffscreen({
          type: "REVOKE_URL",
          url: addResponse.blobUrl
        });

      } else {

        console.warn(
          "Chrome did not report a normal download; " +
          "saving a fallback copy."
        );

        const padded =
          String(imageNumber).padStart(4, "0");

        const fallbackFilename =
          `Ancestry Pages/${safeCaseName}/` +
          `${padded}.${addResponse.extension}`;

        const fallbackDownloadId =
          await chrome.downloads.download({
            url: addResponse.blobUrl,
            filename: fallbackFilename,
            saveAs: false,
            conflictAction: "overwrite"
          });

        await waitForChromeDownloadComplete(
          fallbackDownloadId,
          120000
        );

        await sendToOffscreen({
          type: "REVOKE_URL",
          url: addResponse.blobUrl
        });
      }

      console.log(
        `Finished image ${imageNumber}.`
      );

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

    /*
     * Build the final PDF.
     */
    await setStatus({
      state: "running",
      start: startPage,
      end: endPage,
      current: endPage,
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

    const pdfName =
      `${safeCaseName}_${startPage}-${endPage}.pdf`;

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

    await setStatus({
      state: "done",
      start: startPage,
      end: endPage,
      pdfName,
      caseName: safeCaseName
    });

    await chrome.action.setBadgeText({
      text: "OK"
    });

    console.log(
      `Done: ${pdfName}`
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
     * Closing the offscreen document releases its memory.
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

