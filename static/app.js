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
const signOutputInput = document.getElementById("signOutputInput");
const packageFile = document.getElementById("packageFile");
const fileHint = document.getElementById("fileHint");
const strategyCard = document.getElementById("strategyCard");
const compatibilityHint = document.getElementById("compatibilityHint");
const signatureModeHint = document.getElementById("signatureModeHint");
const signingConfigHint = document.getElementById("signingConfigHint");
const signaturePrivateKey = document.getElementById("signaturePrivateKey");
const signaturePublicKey = document.getElementById("signaturePublicKey");
const signaturePrivateKeyHint = document.getElementById("signaturePrivateKeyHint");
const signaturePublicKeyHint = document.getElementById("signaturePublicKeyHint");
const verificationNotice = document.getElementById("verificationNotice");
const managedKeyHeadline = document.getElementById("managedKeyHeadline");
const managedKeyStatus = document.getElementById("managedKeyStatus");
const managedKeyGeneratedAt = document.getElementById("managedKeyGeneratedAt");
const managedKeyFingerprint = document.getElementById("managedKeyFingerprint");
const managedKeySourceChip = document.getElementById("managedKeySourceChip");
const managedKeyCliChip = document.getElementById("managedKeyCliChip");
const managedKeyOpenSslChip = document.getElementById("managedKeyOpenSslChip");
const managedKeyActionHint = document.getElementById("managedKeyActionHint");
const generateManagedKeyButton = document.getElementById("generateManagedKeyButton");
const downloadManagedPublicKeyButton = document.getElementById("downloadManagedPublicKeyButton");
const downloadManagedPrivateKeyButton = document.getElementById("downloadManagedPrivateKeyButton");
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
let currentSignOutput = false;
let currentJobStatus = "idle";
let currentEventSource = null;
let appConfig = null;
let isSubmitting = false;
let isGeneratingManagedKeys = false;

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function signingConfig() {
  return appConfig?.signing || {};
}

function managedKeyPair() {
  return signingConfig().managed_key_pair || {};
}

function signatureCliStatus() {
  return signingConfig().signature_cli || {};
}

function opensslStatus() {
  return signingConfig().openssl || {};
}

function hasServerPrivateKey() {
  return Boolean(signingConfig().active_private_key_configured);
}

function hasServerPublicKey() {
  return Boolean(signingConfig().active_public_key_configured);
}

function hasUploadedPrivateKey() {
  return Boolean(signaturePrivateKey.files?.[0]);
}

function hasUploadedPublicKey() {
  return Boolean(signaturePublicKey.files?.[0]);
}

function hasSigningPrivateKeyAvailable() {
  return hasUploadedPrivateKey() || hasServerPrivateKey();
}

function signatureCliSupported() {
  return Boolean(signatureCliStatus().supported);
}

function canSignInCurrentRuntime() {
  return signatureCliSupported() && hasSigningPrivateKeyAvailable();
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
    (currentSignOutput && !canSignInCurrentRuntime()) ||
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

function buildSigningConfigHint() {
  if (!appConfig) {
    return "Inspecting signing configuration...";
  }

  const signing = signingConfig();
  const privateKeyState = signing.active_private_key_configured
    ? `Active private key: ${signing.active_private_key_name} (${signing.active_private_key_source}).`
    : signing.server_private_key_error
      ? `Configured private key is invalid: ${signing.server_private_key_error}.`
      : "No active private key is available yet.";

  const publicKeyState = signing.active_public_key_configured
    ? `Active public key: ${signing.active_public_key_name} (${signing.active_public_key_source}).`
    : signing.server_public_key_error
      ? `Configured public key is invalid: ${signing.server_public_key_error}.`
      : "No active public key is available yet.";

  const cliState = signatureCliSupported()
    ? `Bundled CLI ${signatureCliStatus().binary_name} supports plugin signatures.`
    : signatureCliStatus().error || "Bundled CLI signature capability is unavailable.";

  return `${privateKeyState} ${publicKeyState} ${cliState}`;
}

function renderManagedKeyPanel() {
  const managed = managedKeyPair();
  const activeSource = signingConfig().active_private_key_source || "none";

  managedKeyHeadline.textContent = managed.configured
    ? "Managed signing key pair is ready"
    : "No managed signing key pair yet";
  managedKeyStatus.textContent = managed.configured
    ? "This key pair lives in the packager service. Download the public key once, trust it in Dify, and then end users can just upload packages."
    : "Generate a managed key pair once in this page, then download the public key and register it in Dify.";

  managedKeyGeneratedAt.textContent = formatDate(managed.generated_at);
  managedKeyFingerprint.textContent = managed.public_key_fingerprint || "-";

  managedKeySourceChip.textContent = `Source ${String(activeSource || "none").toUpperCase()}`;
  managedKeyCliChip.textContent = signatureCliSupported()
    ? `CLI ${signatureCliStatus().binary_name || "ready"}`
    : "CLI Upgrade Required";
  managedKeyOpenSslChip.textContent = opensslStatus().available
    ? "OpenSSL Ready"
    : "OpenSSL Missing";

  generateManagedKeyButton.textContent = isGeneratingManagedKeys
    ? "Generating..."
    : managed.configured
      ? "Rotate Key Pair"
      : "Generate Key Pair";
  generateManagedKeyButton.disabled = isGeneratingManagedKeys || !opensslStatus().available;
  downloadManagedPublicKeyButton.disabled = !managed.configured;
  downloadManagedPrivateKeyButton.disabled = !managed.configured;

  if (!opensslStatus().available) {
    managedKeyActionHint.textContent = opensslStatus().error || "Install OpenSSL in the runtime first.";
  } else if (!managed.configured) {
    managedKeyActionHint.textContent =
      "Admin step: generate the key pair here, download the public key, and add it to Dify plugin_daemon once.";
  } else if (activeSource === "env" || activeSource === "env_invalid") {
    managedKeyActionHint.textContent =
      "Managed keys exist, but env-configured signing keys are taking precedence right now.";
  } else if (!signatureCliSupported()) {
    managedKeyActionHint.textContent =
      signatureCliStatus().error || "The managed key pair is ready, but the bundled Dify CLI still cannot sign packages.";
  } else {
    managedKeyActionHint.textContent =
      "Managed keys are active. After Dify trusts the public key, end users can just upload plugin packages here.";
  }
}

function updateSignatureHints() {
  const privateKeyName = signaturePrivateKey.files?.[0]?.name;
  const publicKeyName = signaturePublicKey.files?.[0]?.name;
  const signing = signingConfig();

  signaturePrivateKeyHint.textContent = privateKeyName
    ? `Uploaded for this job: ${privateKeyName}`
    : hasServerPrivateKey()
      ? `No upload required. The active signing key is ${signing.active_private_key_name} (${signing.active_private_key_source}).`
      : "Advanced override. Upload a private key for this job, or generate a managed key pair in the page.";

  signaturePublicKeyHint.textContent = publicKeyName
    ? `Uploaded for local verification: ${publicKeyName}`
    : hasServerPublicKey()
      ? `No upload required. The active verification key is ${signing.active_public_key_name} (${signing.active_public_key_source}).`
      : "Advanced override. Upload a public key if you want local verification to use a different key.";

  if (!currentSignOutput) {
    signatureModeHint.textContent =
      "Unsigned output is still allowed here, but installation will fail on Dify instances with signature verification enabled.";
  } else if (!signatureCliSupported()) {
    signatureModeHint.textContent =
      signatureCliStatus().error || "Signing is enabled, but the bundled Dify CLI does not support plugin signatures.";
  } else if (hasUploadedPrivateKey()) {
    signatureModeHint.textContent = `This job will sign the output with the uploaded private key: ${privateKeyName}.`;
  } else if (hasServerPrivateKey()) {
    signatureModeHint.textContent = `This job will sign the output with ${signing.active_private_key_name} (${signing.active_private_key_source}).`;
  } else {
    signatureModeHint.textContent =
      "Signing is enabled, but no private key is available yet. Generate a managed key pair or upload a one-off private key.";
  }

  if (hasUploadedPublicKey()) {
    verificationNotice.innerHTML =
      `The backend will verify the signed package with <code>${escapeHtml(publicKeyName)}</code> after signing. Dify still needs the same public key in <code>THIRD_PARTY_SIGNATURE_VERIFICATION_PUBLIC_KEYS</code>.`;
  } else if (hasServerPublicKey()) {
    verificationNotice.innerHTML =
      `The backend will verify the signed package with <code>${escapeHtml(signing.active_public_key_name)}</code> (${escapeHtml(signing.active_public_key_source)}). Dify still needs the same public key in <code>THIRD_PARTY_SIGNATURE_VERIFICATION_PUBLIC_KEYS</code>.`;
  } else {
    verificationNotice.innerHTML =
      "Dify still needs the matching public key in <code>THIRD_PARTY_SIGNATURE_VERIFICATION_PUBLIC_KEYS</code>, or signature enforcement must be disabled.";
  }

  signingConfigHint.textContent = buildSigningConfigHint();
  renderManagedKeyPanel();
  syncSubmitState();
}

function applySigningConfig(signing) {
  appConfig = appConfig || {};
  appConfig.signing = signing || {};
}

async function loadSigningConfig() {
  const response = await fetch("/api/signing");
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || "Failed to load signing config");
  }

  applySigningConfig(payload);
  updateSignatureHints();
}

function downloadManagedKey(kind) {
  window.location.href = `/api/signing/managed/download/${kind}`;
}

async function generateManagedKeyPair() {
  const overwrite = managedKeyPair().configured
    ? window.confirm("A managed key pair already exists. Rotate it now? Download the old private key first if you still need a backup.")
    : false;

  if (managedKeyPair().configured && !overwrite) {
    return;
  }

  isGeneratingManagedKeys = true;
  renderManagedKeyPanel();
  submitHint.textContent = overwrite
    ? "Rotating managed signing key pair..."
    : "Generating managed signing key pair...";

  try {
    const response = await fetch(`/api/signing/managed/generate?overwrite=${overwrite ? "true" : "false"}`, {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || "Failed to generate managed signing keys");
    }

    applySigningConfig(payload.signing);
    updateSignatureHints();

    if (!currentSignOutput && canSignInCurrentRuntime()) {
      setSignOutput(true);
    }

    const message = overwrite
      ? "Managed signing key pair rotated."
      : "Managed signing key pair generated.";
    submitHint.textContent = message;
    appendLog(`[deck] ${message}`);
  } catch (error) {
    submitHint.textContent = error.message;
    appendLog(`[deck] ${error.message}`);
  } finally {
    isGeneratingManagedKeys = false;
    renderManagedKeyPanel();
  }
}

function setSignOutput(enabled) {
  currentSignOutput = enabled;
  signOutputInput.value = String(enabled);

  document.querySelectorAll("#signSwitch .segment-control__item").forEach((button) => {
    const active = String(enabled) === button.dataset.sign;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  updateSignatureHints();
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
  applySigningConfig(appConfig.signing);
  setSignOutput(Boolean(signingConfig().enabled_by_default));

  updateArchAvailability();
  updateStrategyHint();
  updateSignatureHints();
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

document.querySelectorAll("#signSwitch .segment-control__item").forEach((button) => {
  button.addEventListener("click", () => setSignOutput(button.dataset.sign === "true"));
});

packageFile.addEventListener("change", updateFileHint);
signaturePrivateKey.addEventListener("change", updateSignatureHints);
signaturePublicKey.addEventListener("change", updateSignatureHints);
generateManagedKeyButton.addEventListener("click", () => {
  generateManagedKeyPair().catch((error) => {
    submitHint.textContent = error.message;
    appendLog(`[deck] ${error.message}`);
  });
});
downloadManagedPublicKeyButton.addEventListener("click", () => downloadManagedKey("public"));
downloadManagedPrivateKeyButton.addEventListener("click", () => downloadManagedKey("private"));

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
setSignOutput(currentSignOutput);
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
