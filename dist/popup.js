const currentEl = document.getElementById("current");
const caseNameEl = document.getElementById("caseName");
const endPageEl = document.getElementById("endPage");
const statusEl = document.getElementById("status");
const separate = document.getElementById("separate");
const separateNcombine = document.getElementById("separateNcombine");
const combine = document.getElementById("combine");
const stop = document.getElementById("stop");

let activeTabId = null;
let startPage = null;
let pageReady = false;
let jobActive = false;

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
      throw new Error("Could not identify the active tab. Try refreshing the tab.");
    }

    activeTabId = tab.id;

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "READ_PAGE",
      tabId: activeTabId
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Could not read the Ancestry page. Try refreshing the tab."
      );
    }

    startPage = Number(response.pageNumber);

    if (!Number.isInteger(startPage)) {
      throw new Error("The current page number was not valid.");
    }

    currentEl.textContent = startPage;
    endPageEl.min = startPage;
    pageReady = true;
    applyButtonState();
    updateReadinessMessage();

  } catch (error) {
    currentEl.textContent = "Unavailable";
    pageReady = false;
    applyButtonState();
    updateReadinessMessage();
    showError(error.message);
  }
}

async function refreshStatus() {
  const { ancestryJob } =
    await chrome.storage.local.get("ancestryJob");

  if (!ancestryJob) {
    return;
  }

  jobActive =
    ancestryJob.state === "running" ||
    ancestryJob.state === "starting";

  applyButtonState();

  if (ancestryJob.state === "error") {
    showError(ancestryJob.message);
    return;
  }

  if (jobActive) {

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

  if (!isReady()) {
    updateReadinessMessage();
    return;
  }

  if (ancestryJob.state === "done") {
    statusEl.className = "success";
    statusEl.textContent = ancestryJob.pdfName
      ? `Finished. Created ${ancestryJob.pdfName}`
      : `Finished downloading images ${ancestryJob.start}-${ancestryJob.end}.`;
    return;
  }

  if (ancestryJob.state === "stopped") {
    statusEl.className = "";

    if (ancestryJob.current == null) {
      statusEl.textContent = "Stopped by user before any pages were downloaded.";
    } else if (ancestryJob.pdfName) {
      statusEl.textContent =
        `Stopped by user at page ${ancestryJob.current}. ` +
        `PDF saved with pages up to ${ancestryJob.current} (${ancestryJob.pdfName}).`;
    } else {
      statusEl.textContent = `Stopped by user at page ${ancestryJob.current}.`;
    }
  }
}

function isEndPageValid() {
  const raw = endPageEl.value.trim();

  if (raw === "") {
    return false;
  }

  const value = Number(raw);

  return Number.isInteger(value) && value >= startPage;
}

function isReady() {
  return pageReady && isEndPageValid();
}

function setStartButtonsDisabled(disabled) {
  separate.disabled = disabled;
  combine.disabled = disabled;
  separateNcombine.disabled = disabled;
}

function applyButtonState() {
  if (jobActive) {
    setStartButtonsDisabled(true);
    stop.disabled = false;
    return;
  }

  stop.disabled = true;
  setStartButtonsDisabled(!isReady());
}

function updateReadinessMessage() {
  if (jobActive) {
    return;
  }

  statusEl.className = "";

  if (!pageReady) {
    statusEl.textContent =
      "Please open a file on Ancestry.com that you want to download.";
  } else if (!isEndPageValid()) {
    statusEl.textContent = "Please enter a valid last image #.";
  } else {
    statusEl.textContent = "";
  }
}

async function startJob(mode) {
  try {
    const endPage = Number(endPageEl.value);
    const caseName =
      caseNameEl.value.trim() || "Ancestry Case";

    jobActive = true;
    applyButtonState();
    statusEl.className = "";
    statusEl.textContent = "Starting download...";

    const response = await chrome.runtime.sendMessage({
      target: "background",
      type: "START_JOB",
      tabId: activeTabId,
      endPage,
      caseName,
      mode
    });

    if (!response?.ok) {
      throw new Error(
        response?.error || "Could not communicate within extension components."
      );
    }

  } catch (error) {
    jobActive = false;
    applyButtonState();
    showError(error.message);
  }
}

async function stopJob() {
  stop.disabled = true;

  const response = await chrome.runtime.sendMessage({
    target: "background",
    type: "STOP_JOB"
  });

  if (!response?.ok) {
    showError(
      response?.error || "Could not communicate within extension components."
    );
  }
}

separate.addEventListener("click", () => startJob("separate"));
combine.addEventListener("click", () => startJob("combine"));
separateNcombine.addEventListener("click", () => startJob("both"));
stop.addEventListener("click", () => stopJob());
endPageEl.addEventListener("input", () => {
  applyButtonState();
  updateReadinessMessage();
});

applyButtonState();
updateReadinessMessage();

readCurrentPage();
refreshStatus();

setInterval(refreshStatus, 1000);
