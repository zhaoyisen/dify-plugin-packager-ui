const DEFAULT_CONSOLE_TEXT = "Waiting for a job...";

const STATUS_LABELS = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
};

const STATUS_HINTS = {
  idle: "After dispatch, the telemetry panel keeps refreshing status and logs.",
  queued: "The job is queued and the execution environment is being prepared.",
  running: "The script is running. Live output will continue streaming into the console below.",
  succeeded: "The offline build is ready and can be downloaded directly.",
  failed: "The job failed. Check the output log and input fields.",
};

const SOURCE_LABELS = {
  local: "Local Upload",
  github: "GitHub Release",
  market: "Marketplace",
};

const sourceInput = document.getElementById("sourceInput");
const archInput = document.getElementById("archInput");
const packageFile = document.getElementById("packageFile");
const fileHint = document.getElementById("fileHint");
const strategyCard = document.getElementById("strategyCard");
const compatibilityHint = document.getElementById("compatibilityHint");
const jobForm = document.getElementById("jobForm");
const submitButton = document.getElementById("submitButton");
const submitHint = document.getElementById("submitHint");
const consoleOutput = document.getElementById("consoleOutput");
const jobIdentity = document.getElementById("jobIdentity");
const jobStatus = document.getElementById("jobStatus");
const jobSource = document.getElementById("jobSource");
const jobUpdatedAt = document.getElementById("jobUpdatedAt");
const artifactName = document.getElementById("artifactName");
const artifactLink = document.getElementById("artifactLink");
const hostArchChip = document.getElementById("hostArchChip");
const hostOsChip = document.getElementById("hostOsChip");
const mirrorChip = document.getElementById("mirrorChip");
const jobsList = document.getElementById("jobsList");
const clearConsoleButton = document.getElementById("clearConsoleButton");
const refreshJobsButton = document.getElementById("refreshJobsButton");
const uploadDropzone = document.querySelector(".upload-dropzone");

let currentJobId = null;
let currentSource = "local";
let currentArch = "amd64";
let currentJobStatus = "idle";
let currentEventSource = null;
let appConfig = null;
let isSubmitting = false;

function formatStatusClass(status) {
  return `status-pill status-pill--${status || "idle"}`;
}

function formatStatusText(status) {
  return STATUS_LABELS[status] || status || STATUS_LABELS.idle;
}

function formatSourceText(source) {
  return SOURCE_LABELS[source] || source || "-";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("en-CA", { hour12: false });
}

function simplifyUrl(value) {
  if (!value) {
    return "--";
  }

  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function isTargetUnsupported(arch) {
  if (!appConfig) {
    return false;
  }

  return (appConfig.unsupported_pairs || []).some((pair) => pair.target_arch === arch);
}

function syncSubmitState() {
  submitButton.disabled =
    isSubmitting ||
    isTargetUnsupported(currentArch) ||
    currentJobStatus === "queued" ||
    currentJobStatus === "running";
}

function resetConsole(text = DEFAULT_CONSOLE_TEXT) {
  consoleOutput.textContent = text;
  consoleOutput.scrollTop = 0;
}

function appendLog(line) {
  const current = consoleOutput.textContent.trim();
  const next =
    current && current !== DEFAULT_CONSOLE_TEXT ? `${current}\n${line}` : line;

  consoleOutput.textContent = next.trim();
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function updateFileHint() {
  const selectedName = packageFile.files?.[0]?.name;
  fileHint.textContent = selectedName || "Only used in local upload mode";
  uploadDropzone?.classList.toggle("is-filled", Boolean(selectedName));
}

function setSource(source) {
  currentSource = source;
  sourceInput.value = source;
  packageFile.required = source === "local";

  document.querySelectorAll("#sourceSwitch .segment-control__item").forEach((button) => {
    const active = button.dataset.source === source;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  document.querySelectorAll(".source-block").forEach((block) => {
    block.classList.toggle("is-active", block.dataset.block === source);
  });

  document.querySelectorAll(".source-guide__item").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.guide === source);
  });

  updateFileHint();
}

function setArch(arch) {
  if (isTargetUnsupported(arch)) {
    return;
  }

  currentArch = arch;
  archInput.value = arch;

  document.querySelectorAll("#archSwitch .segment-control__item").forEach((button) => {
    const active = button.dataset.arch === arch;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  updateStrategyHint();
  syncSubmitState();
}

function buildCompatibilityHint() {
  if (!appConfig) {
    return "Inspecting runtime";
  }

  if (appConfig.host_os !== "linux") {
    return `Host is ${appConfig.host_os} / ${appConfig.host_arch}. The interface works, but packaging must execute on Linux.`;
  }

  if (appConfig.host_arch === "arm64") {
    return "Host is arm64. Only the native arm64 path is available; reverse packaging to amd64 is not supported.";
  }

  return "Host is amd64. Native amd64 builds work directly, and the amd64 -> arm64 conversion path is available.";
}

function updateStrategyHint() {
  if (!appConfig) {
    strategyCard.textContent = "Reading runtime strategy...";
    return;
  }

  const hostArch = appConfig.host_arch;
  const hostOs = appConfig.host_os;

  if (hostOs !== "linux") {
    strategyCard.textContent = `Current host is ${hostOs} / ${hostArch}. The UI can still be used, but the backend packaging command will fail outside Linux.`;
    return;
  }

  if (currentArch === "arm64" && hostArch !== "arm64") {
    strategyCard.textContent = `Current host is ${hostArch} and the target is arm64. The system will route into the amd64 -> arm64 cross-architecture script chain.`;
    return;
  }

  strategyCard.textContent = `Current host is ${hostArch} and the target is ${currentArch}. The standard repackaging script will be used.`;
}

function updateArchAvailability() {
  let fallbackArch = null;

  document.querySelectorAll("#archSwitch .segment-control__item").forEach((button) => {
    const unsupported = isTargetUnsupported(button.dataset.arch);
    button.disabled = unsupported;
    button.classList.toggle("is-disabled", unsupported);
    button.title = unsupported ? "This target architecture is not supported on the current host." : "";

    if (!unsupported && !fallbackArch) {
      fallbackArch = button.dataset.arch;
    }
  });

  if (isTargetUnsupported(currentArch) && fallbackArch) {
    currentArch = fallbackArch;
    archInput.value = fallbackArch;
  }

  setArch(currentArch);
}

function renderJobState(snapshot) {
  currentJobId = snapshot.id || currentJobId;
  currentJobStatus = snapshot.status || "idle";

  jobIdentity.textContent = snapshot.id || "Not created yet";
  jobSource.textContent = snapshot.source
    ? `${formatSourceText(snapshot.source)} / ${snapshot.target_arch || "-"}`
    : "-";
  jobSource.title = snapshot.source_summary || "";
  jobUpdatedAt.textContent = formatDate(snapshot.updated_at);

  jobStatus.textContent = formatStatusText(snapshot.status);
  jobStatus.className = formatStatusClass(snapshot.status);
  jobStatus.title = snapshot.status || "idle";

  artifactName.textContent = snapshot.artifact_name || "None";

  if (snapshot.artifact_name && snapshot.id) {
    artifactLink.href = `/api/jobs/${snapshot.id}/download`;
    artifactLink.classList.remove("is-disabled");
    artifactLink.setAttribute("aria-disabled", "false");
    artifactLink.setAttribute("download", snapshot.artifact_name);
  } else {
    artifactLink.href = "#";
    artifactLink.classList.add("is-disabled");
    artifactLink.setAttribute("aria-disabled", "true");
    artifactLink.removeAttribute("download");
  }

  submitHint.textContent = snapshot.error || STATUS_HINTS[snapshot.status] || STATUS_HINTS.idle;
  syncSubmitState();
}

function renderJobsList(items) {
  jobsList.replaceChildren();

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "recent-job recent-job--empty";

    const title = document.createElement("div");
    title.className = "recent-job__title";
    title.textContent = "No jobs yet";

    const meta = document.createElement("div");
    meta.className = "recent-job__meta";
    meta.textContent = "Once a job is submitted, the latest 20 runs will appear here.";

    empty.append(title, meta);
    jobsList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `recent-job${item.id === currentJobId ? " is-active" : ""}`;
    button.dataset.jobId = item.id;

    const head = document.createElement("div");
    head.className = "recent-job__head";

    const title = document.createElement("div");
    title.className = "recent-job__title";
    title.textContent = item.id;

    const pill = document.createElement("div");
    pill.className = formatStatusClass(item.status);
    pill.textContent = formatStatusText(item.status);
    pill.title = item.status || "idle";

    head.append(title, pill);

    const meta = document.createElement("div");
    meta.className = "recent-job__meta";
    meta.textContent = item.source_summary || `${formatSourceText(item.source)} / ${item.target_arch}`;

    const submeta = document.createElement("div");
    submeta.className = "recent-job__submeta";

    const route = document.createElement("span");
    route.textContent = `${formatSourceText(item.source)} / ${item.target_arch}`;

    const created = document.createElement("span");
    created.textContent = formatDate(item.created_at);

    submeta.append(route, created);
    button.append(head, meta, submeta);
    fragment.append(button);
  });

  jobsList.append(fragment);
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error("Failed to load runtime config");
  }

  appConfig = await response.json();

  hostArchChip.textContent = `Runtime ${appConfig.host_arch}`;
  hostOsChip.textContent = `${String(appConfig.host_os || "unknown").toUpperCase()} Host`;
  mirrorChip.textContent = `Mirror ${simplifyUrl(appConfig.pip_mirror_url)}`;
  mirrorChip.title = appConfig.pip_mirror_url;
  compatibilityHint.textContent = buildCompatibilityHint();

  updateArchAvailability();
  updateStrategyHint();
}

async function loadJobs() {
  const response = await fetch("/api/jobs");
  if (!response.ok) {
    throw new Error("Failed to load job list");
  }

  const payload = await response.json();
  const items = payload.items || [];
  renderJobsList(items);
  return items;
}

function closeStream() {
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
}

function openJobStream(jobId) {
  closeStream();
  currentEventSource = new EventSource(`/api/jobs/${jobId}/events`);

  currentEventSource.addEventListener("log", (event) => {
    const payload = JSON.parse(event.data);
    appendLog(payload.line);
  });

  currentEventSource.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    renderJobState(payload);
    loadJobs().catch(() => {});
  });

  currentEventSource.addEventListener("end", () => {
    closeStream();
    loadJobs().catch(() => {});
  });

  currentEventSource.onerror = () => {
    closeStream();
  };
}

async function inspectJob(jobId) {
  closeStream();

  const response = await fetch(`/api/jobs/${jobId}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || "Failed to load job details");
  }

  renderJobState(payload);
  resetConsole(payload.logs?.length ? payload.logs.join("\n") : DEFAULT_CONSOLE_TEXT);

  if (payload.status === "queued" || payload.status === "running") {
    openJobStream(payload.id);
  }

  loadJobs().catch(() => {});
}

async function submitJob(event) {
  event.preventDefault();

  closeStream();
  resetConsole();

  isSubmitting = true;
  syncSubmitState();
  submitHint.textContent = "Job submitted. Starting execution thread...";

  const formData = new FormData(jobForm);
  formData.set("source", currentSource);
  formData.set("target_arch", currentArch);

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || "Submit failed");
    }

    renderJobState(payload);
    appendLog("[deck] Job created. Connecting to live output stream.");

    isSubmitting = false;
    syncSubmitState();

    openJobStream(payload.id);
    loadJobs().catch(() => {});
  } catch (error) {
    isSubmitting = false;
    syncSubmitState();
    submitHint.textContent = error.message;
    appendLog(`[deck] ${error.message}`);
  }
}

document.querySelectorAll("#sourceSwitch .segment-control__item").forEach((button) => {
  button.addEventListener("click", () => setSource(button.dataset.source));
});

document.querySelectorAll(".source-guide__item").forEach((button) => {
  button.addEventListener("click", () => setSource(button.dataset.guide));
});

document.querySelectorAll("#archSwitch .segment-control__item").forEach((button) => {
  button.addEventListener("click", () => setArch(button.dataset.arch));
});

packageFile.addEventListener("change", updateFileHint);

clearConsoleButton.addEventListener("click", () => resetConsole());

refreshJobsButton.addEventListener("click", () => {
  loadJobs().catch((error) => {
    submitHint.textContent = error.message;
    appendLog(`[deck] ${error.message}`);
  });
});

jobsList.addEventListener("click", (event) => {
  const card = event.target.closest(".recent-job[data-job-id]");
  if (!card) {
    return;
  }

  inspectJob(card.dataset.jobId).catch((error) => {
    submitHint.textContent = error.message;
    appendLog(`[deck] ${error.message}`);
  });
});

jobForm.addEventListener("submit", submitJob);

setSource(currentSource);
setArch(currentArch);
resetConsole();

Promise.all([loadConfig(), loadJobs()])
  .then(([, items]) => {
    if (!currentJobId && items.length) {
      return inspectJob(items[0].id);
    }

    return null;
  })
  .catch((error) => {
    consoleOutput.textContent = `[deck] Boot failed: ${error.message}`;
    submitHint.textContent = error.message;
  });
