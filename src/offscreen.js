import { PDFDocument } from "pdf-lib";

let pdfDoc = null;
const objectUrls = new Set();

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {

    if (message?.target !== "offscreen") {
      return;
    }

    handleMessage(message)
      .then(sendResponse)
      .catch(error => {
        console.error("Offscreen error:", error);

        sendResponse({
          ok: false,
          error: error.message
        });
      });

    return true;
  }
);

async function handleMessage(message) {

  if (message.type === "RESET") {

    revokeAllUrls();

    pdfDoc = await PDFDocument.create();

    return {
      ok: true
    };
  }


  if (message.type === "ADD_IMAGE") {

    if (!pdfDoc) {
      throw new Error(
        "PDF document has not been initialized."
      );
    }

    console.log(
      `Fetching image ${message.pageNumber}:`,
      message.url
    );

    const response = await fetch(
      message.url,
      {
        credentials: "include"
      }
    );

    if (!response.ok) {
      throw new Error(
        `Could not fetch image ${message.pageNumber}. ` +
        `HTTP ${response.status}`
      );
    }

    const arrayBuffer =
      await response.arrayBuffer();

    const bytes =
      new Uint8Array(arrayBuffer);

    console.log(
      `Fetched image ${message.pageNumber}:`,
      bytes.length,
      "bytes"
    );

    const imageType =
      detectImageType(
        bytes,
        message.filename
      );

    let image;

    if (imageType === "jpg") {

      image =
        await pdfDoc.embedJpg(bytes);

    } else if (imageType === "png") {

      image =
        await pdfDoc.embedPng(bytes);

    } else {

      throw new Error(
        `Image ${message.pageNumber} ` +
        `is not recognized as JPEG or PNG.`
      );
    }

    const dimensions =
      image.size();

    const maxSide = 792;

    const scale =
      maxSide /
      Math.max(
        dimensions.width,
        dimensions.height
      );

    const pageWidth =
      dimensions.width * scale;

    const pageHeight =
      dimensions.height * scale;

    const pdfPage =
      pdfDoc.addPage([
        pageWidth,
        pageHeight
      ]);

    pdfPage.drawImage(
      image,
      {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight
      }
    );

    return {
      ok: true
    };
  }


  if (message.type === "FINALIZE") {

    if (!pdfDoc) {
      throw new Error(
        "No PDF is being built."
      );
    }

    const pdfBytes =
      await pdfDoc.save({
        useObjectStreams: true
      });

    const blob =
      new Blob(
        [pdfBytes],
        {
          type: "application/pdf"
        }
      );

    const blobUrl =
      URL.createObjectURL(blob);

    objectUrls.add(blobUrl);

    return {
      ok: true,
      blobUrl
    };
  }


  if (message.type === "REVOKE_URL") {

    if (
      message.url &&
      objectUrls.has(message.url)
    ) {

      URL.revokeObjectURL(
        message.url
      );

      objectUrls.delete(
        message.url
      );
    }

    return {
      ok: true
    };
  }


  throw new Error(
    `Unknown offscreen message: ${message.type}`
  );
}


function detectImageType(
  bytes,
  filename = ""
) {

  // JPEG
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpg";
  }

  // PNG
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  const lower =
    String(filename)
      .toLowerCase();

  if (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg")
  ) {
    return "jpg";
  }

  if (
    lower.endsWith(".png")
  ) {
    return "png";
  }

  return null;
}


function revokeAllUrls() {

  for (
    const url of objectUrls
  ) {

    URL.revokeObjectURL(url);
  }

  objectUrls.clear();
}
