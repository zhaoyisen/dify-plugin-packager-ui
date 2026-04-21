const SOURCE_COPY = {
  local: {
    label: "本地上传",
    help: "上传本地 `.difypkg` 文件后，直接进入离线重打包流程。",
    summary: "上传本地插件包",
  },
  github: {
    label: "GitHub Release",
    help: "填写仓库、Release 标签和资产文件名后，系统会自动拉取原始包。",
    summary: "从 GitHub Release 拉取插件包",
  },
  market: {
    label: "Marketplace",
    help: "填写作者、插件名和版本号后，系统会从 Marketplace 下载原始包。",
    summary: "从 Marketplace 下载插件包",
  },
};

const STATUS_COPY = {
  queued: { label: "排队中", tone: "queued" },
  running: { label: "执行中", tone: "running" },
  succeeded: { label: "已完成", tone: "succeeded" },
  failed: { label: "失败", tone: "failed" },
};

const FINAL_STATUSES = new Set(["succeeded", "failed"]);

const state = {
  config: null,
  signing: null,
  jobs: [],
  jobDetails: new Map(),
  page: "workspace",
  selectedSource: "local",
  selectedArch: "amd64",
  signOutput: false,
  advancedSigningOpen: false,
  selectedJobId: null,
  eventSource: null,
  streamJobId: null,
  streamCursor: 0,
  jobsPollTimer: null,
  formNotice: null,
  signingNotice: null,
  submitting: false,
  signingBusy: false,
};

const refs = {
  pageTabs: Array.from(document.querySelectorAll("[data-page]")),
  pagePanels: Array.from(document.querySelectorAll("[data-page-panel]")),
  hostWarning: document.getElementById("hostWarning"),
  topRefreshButton: document.getElementById("topRefreshButton"),
  runtimeBanner: document.getElementById("runtimeBanner"),
  sourceHelp: document.getElementById("sourceHelp"),
  sourceButtons: Array.from(document.querySelectorAll("[data-source]")),
  sourcePanels: Array.from(document.querySelectorAll("[data-source-panel]")),
  packageFile: document.getElementById("packageFile"),
  packageFileName: document.getElementById("packageFileName"),
  githubRepo: document.getElementById("githubRepo"),
  githubRelease: document.getElementById("githubRelease"),
  githubAsset: document.getElementById("githubAsset"),
  marketAuthor: document.getElementById("marketAuthor"),
  marketName: document.getElementById("marketName"),
  marketVersion: document.getElementById("marketVersion"),
  archButtons: Array.from(document.querySelectorAll("[data-arch]")),
  archHelp: document.getElementById("archHelp"),
  signOutputToggle: document.getElementById("signOutputToggle"),
  signHint: document.getElementById("signHint"),
  advancedSigningToggle: document.getElementById("advancedSigningToggle"),
  advancedSigningPanel: document.getElementById("advancedSigningPanel"),
  signaturePrivateKey: document.getElementById("signaturePrivateKey"),
  signaturePublicKey: document.getElementById("signaturePublicKey"),
  privateKeyName: document.getElementById("privateKeyName"),
  publicKeyName: document.getElementById("publicKeyName"),
  summarySource: document.getElementById("summarySource"),
  summaryArch: document.getElementById("summaryArch"),
  summarySign: document.getElementById("summarySign"),
  summaryText: document.getElementById("summaryText"),
  formNotice: document.getElementById("formNotice"),
  submitTip: document.getElementById("submitTip"),
  submitButton: document.getElementById("submitButton"),
  submitButtonLabel: document.getElementById("submitButtonLabel"),
  submitButtonMeta: document.getElementById("submitButtonMeta"),
  jobForm: document.getElementById("jobForm"),
  hostValue: document.getElementById("hostValue"),
  hostNote: document.getElementById("hostNote"),
  supportValue: document.getElementById("supportValue"),
  supportNote: document.getElementById("supportNote"),
  mirrorValue: document.getElementById("mirrorValue"),
  mirrorNote: document.getElementById("mirrorNote"),
  signingValue: document.getElementById("signingValue"),
  signingNote: document.getElementById("signingNote"),
  recentJobValue: document.getElementById("recentJobValue"),
  recentJobNote: document.getElementById("recentJobNote"),
  openSigningButton: document.getElementById("openSigningButton"),
  openJobsButton: document.getElementById("openJobsButton"),
  jobsCount: document.getElementById("jobsCount"),
  refreshJobsButton: document.getElementById("refreshJobsButton"),
  jobsList: document.getElementById("jobsList"),
  jobDetailEmpty: document.getElementById("jobDetailEmpty"),
  jobDetail: document.getElementById("jobDetail"),
  detailJobId: document.getElementById("detailJobId"),
  detailStatus: document.getElementById("detailStatus"),
  detailSource: document.getElementById("detailSource"),
  detailSummary: document.getElementById("detailSummary"),
  detailArch: document.getElementById("detailArch"),
  detailCreated: document.getElementById("detailCreated"),
  detailUpdated: document.getElementById("detailUpdated"),
  detailSign: document.getElementById("detailSign"),
  detailSignatureSource: document.getElementById("detailSignatureSource"),
  detailVerificationSource: document.getElementById("detailVerificationSource"),
  detailArtifact: document.getElementById("detailArtifact"),
  detailError: document.getElementById("detailError"),
  jobLogs: document.getElementById("jobLogs"),
  downloadLink: document.getElementById("downloadLink"),
  signingBackdrop: document.getElementById("signingBackdrop"),
  signingDrawer: document.getElementById("signingDrawer"),
  closeSigningDrawer: document.getElementById("closeSigningDrawer"),
  signingNotice: document.getElementById("signingNotice"),
  drawerDefaultSignValue: document.getElementById("drawerDefaultSignValue"),
  drawerDefaultSignNote: document.getElementById("drawerDefaultSignNote"),
  drawerActivePrivateValue: document.getElementById("drawerActivePrivateValue"),
  drawerActivePublicValue: document.getElementById("drawerActivePublicValue"),
  drawerManagedValue: document.getElementById("drawerManagedValue"),
  drawerManagedNote: document.getElementById("drawerManagedNote"),
  drawerFingerprint: document.getElementById("drawerFingerprint"),
  generateManagedButton: document.getElementById("generateManagedButton"),
  downloadManagedPrivate: document.getElementById("downloadManagedPrivate"),
  downloadManagedPublic: document.getElementById("downloadManagedPublic"),
  drawerCliValue: document.getElementById("drawerCliValue"),
  drawerCliNote: document.getElementById("drawerCliNote"),
  drawerOpenSslValue: document.getElementById("drawerOpenSslValue"),
  drawerOpenSslNote: document.getElementById("drawerOpenSslNote"),
  toastRegion: document.getElementById("toastRegion"),
};

function sourceLabel(source) {
  return SOURCE_COPY[source]?.label || source || "-";
}

function statusMeta(status) {
  return STATUS_COPY[status] || { label: status || "未知状态", tone: "" };
}

function hostLabel(hostOs) {
  if (!hostOs) {
    return "-";
  }
  if (hostOs === "linux") {
    return "Linux";
  }
  if (hostOs === "windows") {
    return "Windows";
  }
  if (hostOs === "darwin") {
    return "macOS";
  }
  return hostOs;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url || "-";
  }
}

function translateSourceKey(value) {
  if (value === "env") {
    return "环境变量";
  }
  if (value === "managed") {
    return "托管密钥";
  }
  if (value === "uploaded") {
    return "本次任务上传";
  }
  if (value === "invalid") {
    return "文件不可用";
  }
  if (value === "env_invalid") {
    return "环境变量配置无效";
  }
  if (value === "none" || !value) {
    return "未使用";
  }
  return value;
}

function translateCliStatus(signing) {
  if (!signing?.signature_cli) {
    return {
      value: "签名工具：未知",
      note: "还没有读取到签名工具状态。",
    };
  }
  if (signing.signature_cli.supported) {
    return {
      value: `签名工具：可用（${signing.signature_cli.binary_name}）`,
      note: "当前内置签名工具支持自动签名。",
    };
  }
  if (state.config?.host_os !== "linux") {
    return {
      value: `签名工具：不可用（${signing.signature_cli.binary_name}）`,
      note: "当前服务不是 Linux 环境，内置签名工具无法执行。",
    };
  }
  if (signing.signature_cli.error) {
    return {
      value: `签名工具：不可用（${signing.signature_cli.binary_name}）`,
      note: "当前环境的内置签名工具不可用，请检查运行环境或更换工具版本。",
    };
  }
  return {
    value: `签名工具：不可用（${signing.signature_cli.binary_name}）`,
    note: "当前环境的内置签名工具不可用。",
  };
}

function translateOpenSslStatus(signing) {
  if (!signing?.openssl) {
    return {
      value: "OpenSSL：未知",
      note: "还没有读取到 OpenSSL 状态。",
    };
  }
  if (signing.openssl.available) {
    return {
      value: `OpenSSL：可用`,
      note: signing.openssl.version || "当前环境可生成托管密钥。",
    };
  }
  return {
    value: "OpenSSL：不可用",
    note: "当前环境没有可用的 OpenSSL，无法生成托管签名密钥。",
  };
}

function defaultSigningText(signing) {
  if (!signing) {
    return {
      value: "正在读取",
      note: "正在检查默认签名能力。",
    };
  }
  if (signing.enabled_by_default) {
    return {
      value: "可直接签名",
      note: `当前会使用${translateSourceKey(signing.active_private_key_source)}作为默认私钥。`,
    };
  }
  if (!signing.signature_cli?.supported) {
    return {
      value: "当前不可用",
      note: "签名工具不可用，暂时无法使用默认签名。",
    };
  }
  if (!signing.active_private_key_configured) {
    return {
      value: "当前不可用",
      note: "没有可用的默认私钥。你可以先生成托管密钥，或在任务里上传私钥。",
    };
  }
  return {
    value: "当前不可用",
    note: "默认签名暂时不可用，请检查签名环境。",
  };
}

function activePrivateText(signing) {
  if (!signing?.active_private_key_configured) {
    return "私钥：未配置";
  }
  return `私钥：${translateSourceKey(signing.active_private_key_source)} / ${signing.active_private_key_name || "-"}`;
}

function activePublicText(signing) {
  if (!signing?.active_public_key_configured) {
    return "公钥：未配置";
  }
  return `公钥：${translateSourceKey(signing.active_public_key_source)} / ${signing.active_public_key_name || "-"}`;
}

function readSelectedFileName(input, fallback) {
  return input.files?.[0]?.name || fallback;
}

function canUseDefaultSigning() {
  return Boolean(state.config?.signing?.enabled_by_default);
}

function hasUnsupportedPair(targetArch) {
  const pairs = state.config?.unsupported_pairs || [];
  return pairs.some((item) => item.target_arch === targetArch);
}

function preferredSignSummary() {
  if (!state.signOutput) {
    return {
      chip: "不签名",
      text: "打包完成后不执行签名。",
    };
  }
  if (refs.signaturePrivateKey.files?.[0]) {
    return {
      chip: "使用任务私钥",
      text: "打包完成后会使用你上传的私钥签名。",
    };
  }
  if (canUseDefaultSigning()) {
    return {
      chip: "使用默认签名",
      text: `打包完成后会使用${translateSourceKey(state.config.signing.active_private_key_source)}进行签名。`,
    };
  }
  return {
    chip: "待上传私钥",
    text: "当前没有可用的默认私钥，需要在高级签名设置中上传私钥后才能签名。",
  };
}

function currentSummaryText() {
  const source = SOURCE_COPY[state.selectedSource];
  const sign = preferredSignSummary();
  return `${source.summary}，目标架构为 ${state.selectedArch}，${sign.text}`;
}

function sortJobs(items) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.created_at || left.updated_at || "") || 0;
    const rightTime = Date.parse(right.created_at || right.updated_at || "") || 0;
    return rightTime - leftTime;
  });
}

function getJob(jobId) {
  if (!jobId) {
    return null;
  }
  return state.jobDetails.get(jobId) || state.jobs.find((job) => job.id === jobId) || null;
}

function upsertJob(snapshot) {
  if (!snapshot?.id) {
    return;
  }
  const existing = getJob(snapshot.id) || {};
  const next = {
    ...existing,
    ...snapshot,
    logs: Array.isArray(snapshot.logs)
      ? [...snapshot.logs]
      : Array.isArray(existing.logs)
        ? [...existing.logs]
        : [],
  };

  state.jobDetails.set(snapshot.id, next);

  const listIndex = state.jobs.findIndex((item) => item.id === snapshot.id);
  if (listIndex === -1) {
    state.jobs.unshift(next);
  } else {
    state.jobs[listIndex] = {
      ...state.jobs[listIndex],
      ...next,
    };
  }

  state.jobs = sortJobs(state.jobs).slice(0, 20);
}

function setFormNotice(message, tone = "info") {
  state.formNotice = message ? { message, tone } : null;
}

function setSigningNotice(message, tone = "info") {
  state.signingNotice = message ? { message, tone } : null;
}

function renderNotice(element, payload) {
  if (!payload) {
    element.hidden = true;
    element.textContent = "";
    element.className = "notice";
    return;
  }
  element.hidden = false;
  element.textContent = payload.message;
  element.className = `notice notice--${payload.tone}`;
}

function showToast(title, message, tone = "success") {
  const toast = document.createElement("div");
  toast.className = `toast toast--${tone}`;

  const strong = document.createElement("strong");
  strong.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = message;

  toast.append(strong, paragraph);
  refs.toastRegion.append(toast);

  window.setTimeout(() => {
    toast.remove();
  }, 3200);
}

async function parseError(response) {
  try {
    const payload = await response.json();
    if (typeof payload.detail === "string") {
      return payload.detail;
    }
    if (typeof payload.message === "string") {
      return payload.message;
    }
  } catch {
    return `请求失败（${response.status}）`;
  }
  return `请求失败（${response.status}）`;
}

async function loadConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  state.config = payload;
  state.signing = payload.signing;

  if (!payload.supported_arches.includes(state.selectedArch) || hasUnsupportedPair(state.selectedArch)) {
    const available = payload.supported_arches.find((arch) => !hasUnsupportedPair(arch));
    state.selectedArch = available || payload.supported_arches[0] || "amd64";
  }

  state.signOutput = Boolean(payload.signing?.enabled_by_default);
}

async function loadSigning() {
  const response = await fetch("/api/signing");
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  state.signing = payload;
  if (state.config) {
    state.config.signing = payload;
  }
}

async function loadJobs({ silent = false } = {}) {
  const response = await fetch("/api/jobs");
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  state.jobs = sortJobs(payload.items || []).slice(0, 20);
  state.jobDetails.clear();
  state.jobs.forEach((job) => {
    state.jobDetails.set(job.id, { ...job, logs: Array.isArray(job.logs) ? [...job.logs] : [] });
  });

  if (!state.selectedJobId && state.jobs.length) {
    state.selectedJobId = state.jobs[0].id;
  }
  if (state.selectedJobId && !getJob(state.selectedJobId)) {
    state.selectedJobId = state.jobs[0]?.id || null;
  }

  if (!silent) {
    renderJobs();
    renderWorkspaceSidebar();
  }
}

async function fetchJobDetail(jobId, { silent = false } = {}) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  const payload = await response.json();
  upsertJob(payload);
  if (!silent) {
    renderJobs();
    renderWorkspaceSidebar();
  }
  return payload;
}

function closeJobStream() {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = null;
  state.streamJobId = null;
  state.streamCursor = 0;
}

function applyStreamLog(jobId, line) {
  const existing = getJob(jobId) || { id: jobId, logs: [] };
  const logs = Array.isArray(existing.logs) ? [...existing.logs] : [];

  if (logs[state.streamCursor] === line) {
    state.streamCursor += 1;
    return;
  }

  if (state.streamCursor < logs.length) {
    logs.splice(state.streamCursor, 0, line);
  } else {
    logs.push(line);
  }
  state.streamCursor += 1;
  upsertJob({ ...existing, logs });
}

function syncJobStream() {
  const job = getJob(state.selectedJobId);
  if (!job || FINAL_STATUSES.has(job.status)) {
    closeJobStream();
    return;
  }

  if (state.streamJobId === job.id && state.eventSource) {
    return;
  }

  closeJobStream();
  state.streamJobId = job.id;
  state.streamCursor = 0;
  state.eventSource = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/events`);

  state.eventSource.addEventListener("log", (event) => {
    try {
      const payload = JSON.parse(event.data);
      applyStreamLog(job.id, payload.line);
      renderJobs();
    } catch {
      return;
    }
  });

  state.eventSource.addEventListener("state", (event) => {
    try {
      const payload = JSON.parse(event.data);
      upsertJob(payload);
      renderJobs();
      renderWorkspaceSidebar();
      if (FINAL_STATUSES.has(payload.status)) {
        closeJobStream();
        void fetchJobDetail(job.id, { silent: true }).then(() => {
          renderJobs();
          renderWorkspaceSidebar();
        });
      }
    } catch {
      return;
    }
  });

  state.eventSource.addEventListener("end", () => {
    closeJobStream();
    void fetchJobDetail(job.id, { silent: true }).then(() => {
      renderJobs();
      renderWorkspaceSidebar();
    });
  });

  state.eventSource.onerror = () => {
    closeJobStream();
  };
}

function setPage(page) {
  state.page = page;
  refs.pageTabs.forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  refs.pagePanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.pagePanel === page);
  });
}

function renderTopbar() {
  if (!state.config) {
    refs.hostWarning.textContent = "正在读取服务状态。";
    return;
  }

  const host = `${hostLabel(state.config.host_os)} / ${state.config.host_arch}`;
  if (state.config.host_os !== "linux") {
    refs.hostWarning.textContent = `当前服务运行在 ${host}。真正执行打包需要 Linux 环境，当前环境更适合界面联调和接口验证。`;
    return;
  }
  refs.hostWarning.textContent = `当前服务运行在 ${host}，已经接入真实打包接口、任务中心和默认签名配置。`;
}

function renderSourceArea() {
  const source = SOURCE_COPY[state.selectedSource];
  refs.sourceHelp.textContent = source.help;

  refs.sourceButtons.forEach((button) => {
    const active = button.dataset.source === state.selectedSource;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  refs.sourcePanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.sourcePanel === state.selectedSource);
  });

  refs.packageFileName.textContent = readSelectedFileName(refs.packageFile, "还没有选择文件。");
}

function renderArchArea() {
  const unsupported = state.config?.unsupported_pairs || [];
  const unsupportedTargets = new Set(unsupported.map((item) => item.target_arch));

  refs.archButtons.forEach((button) => {
    const target = button.dataset.arch;
    const disabled = unsupportedTargets.has(target);
    const active = state.selectedArch === target;
    button.disabled = disabled;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (!state.config) {
    refs.archHelp.textContent = "正在读取可用架构。";
    return;
  }

  if (unsupportedTargets.size === 0) {
    refs.archHelp.textContent = `当前宿主为 ${hostLabel(state.config.host_os)} / ${state.config.host_arch}，可使用所有已接入的目标架构。`;
    return;
  }

  refs.archHelp.textContent = `当前宿主为 ${hostLabel(state.config.host_os)} / ${state.config.host_arch}，部分目标架构不可选。`;
}

function renderSigningArea() {
  refs.signOutputToggle.checked = state.signOutput;
  refs.advancedSigningPanel.hidden = !state.advancedSigningOpen;
  refs.advancedSigningToggle.textContent = state.advancedSigningOpen ? "收起高级签名设置" : "高级签名设置";
  refs.advancedSigningToggle.setAttribute("aria-expanded", String(state.advancedSigningOpen));
  refs.privateKeyName.textContent = readSelectedFileName(refs.signaturePrivateKey, "未选择文件");
  refs.publicKeyName.textContent = readSelectedFileName(refs.signaturePublicKey, "未选择文件");

  if (!state.signOutput) {
    refs.signHint.textContent = "本次任务不会对产物签名。";
    return;
  }

  if (refs.signaturePrivateKey.files?.[0]) {
    refs.signHint.textContent = "本次任务会使用你上传的私钥签名。";
    return;
  }

  if (canUseDefaultSigning()) {
    refs.signHint.textContent = `本次任务会使用${translateSourceKey(state.config.signing.active_private_key_source)}作为默认私钥。`;
    return;
  }

  refs.signHint.textContent = "当前没有可用的默认私钥。如果要签名，请在高级签名设置里上传私钥。";
}

function renderSummary() {
  const sign = preferredSignSummary();
  refs.summarySource.textContent = SOURCE_COPY[state.selectedSource].label;
  refs.summaryArch.textContent = state.selectedArch;
  refs.summarySign.textContent = sign.chip;
  refs.summaryText.textContent = currentSummaryText();

  if (state.signOutput && !refs.signaturePrivateKey.files?.[0] && canUseDefaultSigning()) {
    refs.submitTip.textContent = "提交后会使用当前服务的默认签名配置。";
  } else if (state.signOutput && refs.signaturePrivateKey.files?.[0]) {
    refs.submitTip.textContent = "提交后会使用你上传的私钥执行签名。";
  } else if (state.signOutput) {
    refs.submitTip.textContent = "提交前请确认已经提供可用私钥。";
  } else {
    refs.submitTip.textContent = "准备好后即可提交任务。";
  }
}

function renderRuntimeBanner() {
  if (!state.config) {
    refs.runtimeBanner.hidden = true;
    return;
  }

  if (state.config.host_os !== "linux") {
    refs.runtimeBanner.hidden = false;
    refs.runtimeBanner.className = "notice notice--warn";
    refs.runtimeBanner.textContent = "当前服务不是 Linux 环境。你仍然可以提交任务，但执行阶段会因为运行环境不满足而失败。";
    return;
  }

  refs.runtimeBanner.hidden = true;
}

function renderWorkspaceSidebar() {
  if (!state.config) {
    refs.hostValue.textContent = "读取中";
    refs.hostNote.textContent = "正在检查服务运行环境。";
    refs.supportValue.textContent = "读取中";
    refs.supportNote.textContent = "正在读取支持的目标架构。";
    refs.mirrorValue.textContent = "读取中";
    refs.mirrorNote.textContent = "正在读取服务配置。";
    refs.signingValue.textContent = "读取中";
    refs.signingNote.textContent = "正在检查签名运行状态。";
    refs.recentJobValue.textContent = "还没有任务记录";
    refs.recentJobNote.textContent = "任务提交后会在这里显示最新状态。";
    return;
  }

  refs.hostValue.textContent = `${hostLabel(state.config.host_os)} / ${state.config.host_arch}`;
  if (state.config.host_os === "linux") {
    refs.hostNote.textContent = "当前服务运行在可执行打包任务的环境中。";
  } else {
    refs.hostNote.textContent = "当前环境适合联调界面，真正执行打包仍需要 Linux。";
  }

  refs.supportValue.textContent = `支持 ${state.config.supported_arches.join("、")}`;
  if ((state.config.unsupported_pairs || []).length) {
    refs.supportNote.textContent = "当前宿主存在部分不支持的架构组合，界面已自动禁用。";
  } else {
    refs.supportNote.textContent = "当前宿主没有额外的架构限制。";
  }

  refs.mirrorValue.textContent = "已读取运行配置";
  refs.mirrorNote.textContent = `PIP：${hostOf(state.config.pip_mirror_url)} / Marketplace：${hostOf(state.config.marketplace_api_url)} / GitHub：${hostOf(state.config.github_api_url)}`;

  const signText = defaultSigningText(state.config.signing);
  refs.signingValue.textContent = signText.value;
  refs.signingNote.textContent = signText.note;

  const latestJob = state.jobs[0];
  if (!latestJob) {
    refs.recentJobValue.textContent = "还没有任务记录";
    refs.recentJobNote.textContent = "提交任务后会在这里显示最新状态。";
    return;
  }

  const latestStatus = statusMeta(latestJob.status);
  refs.recentJobValue.textContent = `${sourceLabel(latestJob.source)} / ${latestJob.target_arch} / ${latestStatus.label}`;
  refs.recentJobNote.textContent = latestJob.source_summary || latestJob.id;
}

function renderWorkspace() {
  renderTopbar();
  renderSourceArea();
  renderArchArea();
  renderSigningArea();
  renderSummary();
  renderRuntimeBanner();
  renderWorkspaceSidebar();
  renderNotice(refs.formNotice, state.formNotice);
  refs.submitButton.classList.toggle("is-busy", state.submitting);
  refs.submitButton.disabled = state.submitting;
  refs.submitButtonLabel.textContent = state.submitting ? "正在创建任务" : "提交打包任务";
  refs.submitButtonMeta.textContent = state.submitting
    ? "任务创建成功后会自动进入任务中心。"
    : "创建任务后会自动跳转到任务中心。";
}

function renderJobsList() {
  refs.jobsList.replaceChildren();
  refs.jobsCount.textContent = `${state.jobs.length} 条任务`;

  if (!state.jobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";

    const strong = document.createElement("strong");
    strong.textContent = "还没有任务";

    const text = document.createElement("p");
    text.textContent = "回到打包工作台提交任务后，这里会自动显示最新任务。";

    empty.append(strong, text);
    refs.jobsList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  state.jobs.forEach((job) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `job-list__item${job.id === state.selectedJobId ? " is-active" : ""}`;
    item.dataset.jobId = job.id;

    const head = document.createElement("div");
    head.className = "job-list__head";

    const title = document.createElement("strong");
    title.textContent = job.id;

    const status = document.createElement("span");
    const statusInfo = statusMeta(job.status);
    status.className = `status-pill status-pill--${statusInfo.tone}`;
    status.textContent = statusInfo.label;

    head.append(title, status);

    const summary = document.createElement("p");
    summary.className = "job-list__summary";
    summary.textContent = job.source_summary || "-";

    const meta = document.createElement("div");
    meta.className = "job-list__meta";

    const left = document.createElement("span");
    left.textContent = `${sourceLabel(job.source)} / ${job.target_arch} / ${job.sign_output ? "已签名" : "未签名"}`;

    const right = document.createElement("span");
    right.textContent = formatDateTime(job.updated_at || job.created_at);

    meta.append(left, right);
    item.append(head, summary, meta);
    fragment.append(item);
  });

  refs.jobsList.append(fragment);
}

function renderJobDetail() {
  const job = getJob(state.selectedJobId);
  if (!job) {
    refs.jobDetailEmpty.hidden = false;
    refs.jobDetail.hidden = true;
    return;
  }

  refs.jobDetailEmpty.hidden = true;
  refs.jobDetail.hidden = false;

  const statusInfo = statusMeta(job.status);
  refs.detailJobId.textContent = job.id;
  refs.detailStatus.className = `status-pill status-pill--${statusInfo.tone}`;
  refs.detailStatus.textContent = statusInfo.label;
  refs.detailSource.textContent = sourceLabel(job.source);
  refs.detailSummary.textContent = job.source_summary || "-";
  refs.detailArch.textContent = job.target_arch || "-";
  refs.detailCreated.textContent = formatDateTime(job.created_at);
  refs.detailUpdated.textContent = formatDateTime(job.updated_at);
  refs.detailSign.textContent = job.sign_output ? "已开启" : "未开启";
  refs.detailSignatureSource.textContent = job.sign_output
    ? translateSourceKey(job.meta?.signature_source)
    : "未使用";
  refs.detailVerificationSource.textContent = job.sign_output
    ? translateSourceKey(job.meta?.verification_source)
    : "未使用";
  refs.detailArtifact.textContent = job.artifact_name || (job.status === "failed" ? "没有可用产物" : "任务尚未完成");

  if (job.error) {
    refs.detailError.hidden = false;
    refs.detailError.textContent = job.error;
  } else {
    refs.detailError.hidden = true;
    refs.detailError.textContent = "";
  }

  if (job.status === "succeeded" && job.artifact_name) {
    refs.downloadLink.hidden = false;
    refs.downloadLink.href = `/api/jobs/${encodeURIComponent(job.id)}/download`;
    refs.downloadLink.setAttribute("download", job.artifact_name);
  } else {
    refs.downloadLink.hidden = true;
    refs.downloadLink.removeAttribute("download");
    refs.downloadLink.href = "#";
  }

  const logs = Array.isArray(job.logs) ? job.logs : [];
  if (logs.length) {
    refs.jobLogs.textContent = logs.join("\n");
  } else if (FINAL_STATUSES.has(job.status)) {
    refs.jobLogs.textContent = "任务已结束，当前没有更多日志。";
  } else {
    refs.jobLogs.textContent = "任务刚创建完成，正在等待日志输出。";
  }
}

function renderJobs() {
  renderJobsList();
  renderJobDetail();
}

function renderSigningDrawer() {
  const signing = state.signing || state.config?.signing;
  const defaultText = defaultSigningText(signing);
  const cliText = translateCliStatus(signing);
  const opensslText = translateOpenSslStatus(signing);
  const managed = signing?.managed_key_pair;

  refs.drawerDefaultSignValue.textContent = defaultText.value;
  refs.drawerDefaultSignNote.textContent = defaultText.note;
  refs.drawerActivePrivateValue.textContent = activePrivateText(signing);
  refs.drawerActivePublicValue.textContent = activePublicText(signing);

  if (!managed?.configured) {
    refs.drawerManagedValue.textContent = "还没有托管密钥";
    refs.drawerManagedNote.textContent = "生成后就可以把托管密钥作为默认签名来源使用。";
    refs.drawerFingerprint.hidden = true;
    refs.drawerFingerprint.textContent = "";
    refs.generateManagedButton.textContent = state.signingBusy ? "正在生成托管密钥" : "生成托管密钥";
    refs.downloadManagedPrivate.hidden = true;
    refs.downloadManagedPublic.hidden = true;
  } else {
    refs.drawerManagedValue.textContent = "托管密钥已就绪";
    refs.drawerManagedNote.textContent = managed.generated_at
      ? `生成时间：${formatDateTime(managed.generated_at)}`
      : "托管密钥已生成，可直接下载备份。";
    if (managed.public_key_fingerprint) {
      refs.drawerFingerprint.hidden = false;
      refs.drawerFingerprint.textContent = `公钥指纹：${managed.public_key_fingerprint.slice(0, 16)}...`;
    } else {
      refs.drawerFingerprint.hidden = true;
      refs.drawerFingerprint.textContent = "";
    }
    refs.generateManagedButton.textContent = state.signingBusy ? "正在重新生成" : "重新生成托管密钥";
    refs.downloadManagedPrivate.hidden = false;
    refs.downloadManagedPublic.hidden = false;
    refs.downloadManagedPrivate.href = "/api/signing/managed/download/private";
    refs.downloadManagedPublic.href = "/api/signing/managed/download/public";
    refs.downloadManagedPrivate.setAttribute("download", managed.private_key_name || "managed-private.pem");
    refs.downloadManagedPublic.setAttribute("download", managed.public_key_name || "managed-public.pem");
  }

  refs.generateManagedButton.disabled = state.signingBusy;
  refs.drawerCliValue.textContent = cliText.value;
  refs.drawerCliNote.textContent = cliText.note;
  refs.drawerOpenSslValue.textContent = opensslText.value;
  refs.drawerOpenSslNote.textContent = opensslText.note;
  renderNotice(refs.signingNotice, state.signingNotice);
}

function renderAll() {
  setPage(state.page);
  renderWorkspace();
  renderJobs();
  renderSigningDrawer();
}

function validateForm() {
  if (state.selectedSource === "local" && !refs.packageFile.files?.[0]) {
    return "请先选择要打包的 `.difypkg` 文件。";
  }
  if (state.selectedSource === "github") {
    if (!refs.githubRepo.value.trim() || !refs.githubRelease.value.trim() || !refs.githubAsset.value.trim()) {
      return "请完整填写 GitHub Release 需要的仓库名、Release 标签和资产文件名。";
    }
  }
  if (state.selectedSource === "market") {
    if (!refs.marketAuthor.value.trim() || !refs.marketName.value.trim() || !refs.marketVersion.value.trim()) {
      return "请完整填写 Marketplace 需要的作者名、插件名和版本号。";
    }
  }
  if (hasUnsupportedPair(state.selectedArch)) {
    return "当前服务不支持所选的目标架构，请重新选择。";
  }
  if (state.signOutput && !canUseDefaultSigning() && !refs.signaturePrivateKey.files?.[0]) {
    return "当前没有可用的默认私钥，请在高级签名设置里上传私钥，或先生成托管密钥。";
  }
  return null;
}

function buildJobFormData() {
  const formData = new FormData();
  formData.append("source", state.selectedSource);
  formData.append("target_arch", state.selectedArch);
  formData.append("sign_output", state.signOutput ? "true" : "false");

  if (state.selectedSource === "local") {
    formData.append("package_file", refs.packageFile.files[0]);
  }
  if (state.selectedSource === "github") {
    formData.append("github_repo", refs.githubRepo.value.trim());
    formData.append("github_release", refs.githubRelease.value.trim());
    formData.append("github_asset", refs.githubAsset.value.trim());
  }
  if (state.selectedSource === "market") {
    formData.append("market_author", refs.marketAuthor.value.trim());
    formData.append("market_name", refs.marketName.value.trim());
    formData.append("market_version", refs.marketVersion.value.trim());
  }
  if (state.signOutput && refs.signaturePrivateKey.files?.[0]) {
    formData.append("signature_private_key", refs.signaturePrivateKey.files[0]);
  }
  if (state.signOutput && refs.signaturePublicKey.files?.[0]) {
    formData.append("signature_public_key", refs.signaturePublicKey.files[0]);
  }
  return formData;
}

function clearSensitiveUploads() {
  refs.signaturePrivateKey.value = "";
  refs.signaturePublicKey.value = "";
}

async function handleJobSubmit(event) {
  event.preventDefault();
  const validationError = validateForm();
  if (validationError) {
    setFormNotice(validationError, "error");
    renderWorkspace();
    return;
  }

  state.submitting = true;
  setFormNotice(null);
  renderWorkspace();

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      body: buildJobFormData(),
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    const payload = await response.json();
    upsertJob(payload);
    clearSensitiveUploads();
    state.selectedJobId = payload.id;
    state.page = "jobs";
    renderAll();

    await fetchJobDetail(payload.id, { silent: true });
    syncJobStream();
    renderAll();

    showToast("任务已创建", "已经切换到任务中心，你可以直接查看状态和日志。");
  } catch (error) {
    setFormNotice(error.message || "任务创建失败，请稍后再试。", "error");
    renderWorkspace();
  } finally {
    state.submitting = false;
    renderWorkspace();
  }
}

async function handleRefreshAll() {
  try {
    await Promise.all([loadConfig(), loadJobs({ silent: true })]);
    if (state.selectedJobId) {
      await fetchJobDetail(state.selectedJobId, { silent: true });
    }
    syncJobStream();
    renderAll();
    showToast("数据已刷新", "工作台和任务中心都已更新。", "success");
  } catch (error) {
    showToast("刷新失败", error.message || "请稍后再试。", "error");
  }
}

async function refreshJobsOnly({ toast = false } = {}) {
  try {
    await loadJobs({ silent: true });
    if (state.selectedJobId) {
      await fetchJobDetail(state.selectedJobId, { silent: true });
    }
    syncJobStream();
    renderAll();
    if (toast) {
      showToast("任务已刷新", "最近任务列表已经更新。", "success");
    }
  } catch (error) {
    if (toast) {
      showToast("刷新失败", error.message || "请稍后再试。", "error");
    }
  }
}

async function selectJob(jobId) {
  state.selectedJobId = jobId;
  renderJobs();
  try {
    await fetchJobDetail(jobId, { silent: true });
  } catch {
    // keep last known snapshot
  }
  syncJobStream();
  renderAll();
}

function openSigningDrawer() {
  refs.signingBackdrop.hidden = false;
  refs.signingDrawer.hidden = false;
  refs.signingDrawer.classList.add("is-open");
  refs.signingDrawer.setAttribute("aria-hidden", "false");
  setSigningNotice(null);
  renderSigningDrawer();
  void loadSigning()
    .then(() => {
      renderSigningDrawer();
      renderWorkspaceSidebar();
    })
    .catch((error) => {
      setSigningNotice(error.message || "签名状态读取失败。", "error");
      renderSigningDrawer();
    });
}

function closeSigningDrawer() {
  refs.signingDrawer.classList.remove("is-open");
  refs.signingDrawer.setAttribute("aria-hidden", "true");
  refs.signingBackdrop.hidden = true;
  refs.signingDrawer.hidden = true;
}

async function handleGenerateManagedKeys() {
  const managedConfigured = Boolean(state.signing?.managed_key_pair?.configured);
  if (managedConfigured) {
    const confirmed = window.confirm("重新生成会覆盖当前托管密钥。确定继续吗？");
    if (!confirmed) {
      return;
    }
  }

  state.signingBusy = true;
  setSigningNotice("正在生成托管密钥，请稍候。", "info");
  renderSigningDrawer();

  try {
    const response = await fetch(`/api/signing/managed/generate?overwrite=${managedConfigured ? "true" : "false"}`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await parseError(response));
    }
    const payload = await response.json();
    state.signing = payload.signing;
    if (state.config) {
      state.config.signing = payload.signing;
    }
    setSigningNotice(payload.message || "托管密钥已生成。", "success");
    renderSigningDrawer();
    renderWorkspaceSidebar();
    renderSigningArea();
    renderSummary();
    showToast("托管密钥已更新", "默认签名状态已经同步刷新。", "success");
  } catch (error) {
    setSigningNotice(error.message || "托管密钥生成失败。", "error");
    renderSigningDrawer();
  } finally {
    state.signingBusy = false;
    renderSigningDrawer();
  }
}

function bindEvents() {
  refs.pageTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const page = button.dataset.page;
      state.page = page;
      renderAll();
      if (page === "jobs") {
        void refreshJobsOnly();
      }
    });
  });

  refs.topRefreshButton.addEventListener("click", () => {
    void handleRefreshAll();
  });

  refs.openJobsButton.addEventListener("click", () => {
    state.page = "jobs";
    renderAll();
    void refreshJobsOnly();
  });

  refs.sourceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedSource = button.dataset.source;
      setFormNotice(null);
      renderWorkspace();
    });
  });

  refs.archButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }
      state.selectedArch = button.dataset.arch;
      renderWorkspace();
    });
  });

  refs.signOutputToggle.addEventListener("change", () => {
    state.signOutput = refs.signOutputToggle.checked;
    renderWorkspace();
  });

  refs.advancedSigningToggle.addEventListener("click", () => {
    state.advancedSigningOpen = !state.advancedSigningOpen;
    renderWorkspace();
  });

  refs.packageFile.addEventListener("change", () => {
    renderSourceArea();
    renderSummary();
  });

  refs.signaturePrivateKey.addEventListener("change", () => {
    renderSigningArea();
    renderSummary();
  });

  refs.signaturePublicKey.addEventListener("change", () => {
    renderSigningArea();
  });

  refs.jobForm.addEventListener("submit", handleJobSubmit);

  refs.refreshJobsButton.addEventListener("click", () => {
    void refreshJobsOnly({ toast: true });
  });

  refs.jobsList.addEventListener("click", (event) => {
    const item = event.target.closest("[data-job-id]");
    if (!item) {
      return;
    }
    void selectJob(item.dataset.jobId);
  });

  refs.openSigningButton.addEventListener("click", openSigningDrawer);
  refs.closeSigningDrawer.addEventListener("click", closeSigningDrawer);
  refs.signingBackdrop.addEventListener("click", closeSigningDrawer);
  refs.generateManagedButton.addEventListener("click", () => {
    void handleGenerateManagedKeys();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && refs.signingDrawer.classList.contains("is-open")) {
      closeSigningDrawer();
    }
  });
}

function startJobsPolling() {
  if (state.jobsPollTimer) {
    window.clearInterval(state.jobsPollTimer);
  }
  state.jobsPollTimer = window.setInterval(() => {
    void refreshJobsOnly();
  }, 12000);
}

async function initialize() {
  bindEvents();
  renderAll();

  try {
    await Promise.all([loadConfig(), loadJobs({ silent: true })]);
    if (state.selectedJobId) {
      await fetchJobDetail(state.selectedJobId, { silent: true });
    }
    syncJobStream();
    renderAll();
    startJobsPolling();
  } catch (error) {
    setFormNotice(error.message || "页面初始化失败，请刷新后重试。", "error");
    renderAll();
    showToast("初始化失败", error.message || "请刷新后重试。", "error");
  }
}

initialize();
