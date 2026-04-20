const DEFAULT_CONSOLE_TEXT = "等待任务启动…";

const STATUS_LABELS = {
  idle: "待机",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
};

const STATUS_HINTS = {
  idle: "任务启动后，右侧会持续刷新状态与日志。",
  queued: "任务已进入队列，正在准备执行环境。",
  running: "脚本执行中，实时日志会持续流入下方终端。",
  succeeded: "离线包已生成，可以直接下载。",
  failed: "任务执行失败，请检查日志输出和输入参数。",
};

const SOURCE_LABELS = {
  local: "本地上传",
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

  return date.toLocaleString("zh-CN", { hour12: false });
}

function simplifyUrl(value) {
  if (!value) {
    return "--";
  }

  try {
    const url = new URL(value);
    return url.host;
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
    return "等待环境探测";
  }

  if (appConfig.host_os !== "linux") {
    return `当前宿主是 ${appConfig.host_os} / ${appConfig.host_arch}，界面可运行，但真正打包必须在 Linux 环境执行。`;
  }

  if (appConfig.host_arch === "arm64") {
    return "当前是 arm64 宿主，仅支持 arm64 目标，不支持反向生成 amd64。";
  }

  return "当前是 amd64 宿主，可原生打 amd64，也可切换到 amd64 -> arm64 的转换链路。";
}

function updateStrategyHint() {
  if (!appConfig) {
    strategyCard.textContent = "正在读取运行环境信息…";
    return;
  }

  const hostArch = appConfig.host_arch;
  const hostOs = appConfig.host_os;

  if (hostOs !== "linux") {
    strategyCard.textContent = `当前宿主为 ${hostOs} / ${hostArch}。界面可操作，但后台重打包命令会因非 Linux 环境而失败。`;
    return;
  }

  if (currentArch === "arm64" && hostArch !== "arm64") {
    strategyCard.textContent = `当前宿主是 ${hostArch}，目标是 arm64。系统会自动调用 amd64 -> arm64 的跨架构脚本。`;
    return;
  }

  strategyCard.textContent = `当前宿主是 ${hostArch}，目标是 ${currentArch}。系统会直接使用常规重打包脚本。`;
}

function updateArchAvailability() {
  let fallbackArch = null;

  document.querySelectorAll("#archSwitch .segment-control__item").forEach((button) => {
    const unsupported = isTargetUnsupported(button.dataset.arch);
    button.disabled = unsupported;
    button.classList.toggle("is-disabled", unsupported);
    button.title = unsupported ? "当前宿主不支持该目标架构" : "";

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

  jobIdentity.textContent = snapshot.id || "尚未创建";
  jobSource.textContent = snapshot.source
    ? `${formatSourceText(snapshot.source)} / ${snapshot.target_arch || "-"}`
    : "-";
  jobSource.title = snapshot.source_summary || "";
  jobUpdatedAt.textContent = formatDate(snapshot.updated_at);

  jobStatus.textContent = formatStatusText(snapshot.status);
  jobStatus.className = formatStatusClass(snapshot.status);
  jobStatus.title = snapshot.status || "idle";

  artifactName.textContent = snapshot.artifact_name || "暂无";

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
    title.textContent = "暂无任务记录";

    const meta = document.createElement("div");
    meta.className = "recent-job__meta";
    meta.textContent = "一旦提交作业，这里会显示最近 20 条记录。";

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
    throw new Error("读取运行环境失败");
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
    throw new Error("读取任务列表失败");
  }

  const payload = await response.json();
  renderJobsList(payload.items || []);
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
    throw new Error(payload.detail || "读取任务详情失败");
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
  submitHint.textContent = "任务已提交，正在启动执行线程…";

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
      throw new Error(payload.detail || "提交失败");
    }

    renderJobState(payload);
    appendLog("[deck] 作业已创建，正在接入实时日志流。");

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

packageFile.addEventListener("change", () => {
  fileHint.textContent = packageFile.files?.[0]?.name || "仅在本地上传模式下生效";
});

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

Promise.all([loadConfig(), loadJobs()]).catch((error) => {
  consoleOutput.textContent = `[deck] 初始化失败: ${error.message}`;
  submitHint.textContent = error.message;
});
