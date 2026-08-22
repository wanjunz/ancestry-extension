const currentEl = document.getElementById("current");
const caseNameEl = document.getElementById("caseName");
const endPageEl = document.getElementById("endPage");
const startButton = document.getElementById("startButton");
const statusEl = document.getElementById("status");

let activeTabId = null;
let startPage = null;

function showError(message) {
  statusEl.className = "error";
  statusEl.textContent = `Error: ${message}`;
}

async function readCurrentPage() {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

    if (!tab || !tab.id) {
      throw new Error("Could not identify the active tab.");
    }

    activeTabId = tab.id;

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "READ_PAGE",
      tabId: activeTabId
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Could not read the Ancestry page."
      );
    }

    startPage = Number(response.pageNumber);

    if (!Number.isInteger(startPage)) {
      throw new Error("The current page number was not valid.");
    }

    currentEl.textContent = startPage;
    endPageEl.min = startPage;
    startButton.disabled = false;

  } catch (error) {
    currentEl.textContent = "Unavailable";
    showError(error.message);
  }
}

async function refreshStatus() {
  const { ancestryJob } =
    await chrome.storage.local.get("ancestryJob");

  if (!ancestryJob) {
    return;
  }

  if (
    ancestryJob.state === "running" ||
    ancestryJob.state === "starting"
  ) {
    startButton.disabled = true;

    if (ancestryJob.current) {
      statusEl.className = "";
      statusEl.textContent =
        `Downloading image ${ancestryJob.current} ` +
        `of ${ancestryJob.end}...`;
    } else {
      statusEl.textContent = "Starting...";
    }

    return;
  }

  if (ancestryJob.state === "done") {
    statusEl.className = "success";
    statusEl.textContent =
      `Finished. Created ${ancestryJob.pdfName}`;
    return;
  }

  if (ancestryJob.state === "error") {
    startButton.disabled = false;
    showError(ancestryJob.message);
  }
}

startButton.addEventListener("click", async () => {
  try {
    const endPage = Number(endPageEl.value);
    const caseName =
      caseNameEl.value.trim() || "Ancestry Case";

    if (!Number.isInteger(endPage)) {
      throw new Error("Enter a valid last image number.");
    }

    if (endPage < startPage) {
      throw new Error(
        `Last image must be ${startPage} or higher.`
      );
    }

    startButton.disabled = true;
    statusEl.className = "";
    statusEl.textContent = "Starting download...";

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "START_JOB",
      tabId: activeTabId,
      endPage,
      caseName
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Could not start the job."
      );
    }

  } catch (error) {
    startButton.disabled = false;
    showError(error.message);
  }
});

readCurrentPage();
refreshStatus();

setInterval(refreshStatus, 1000);
