const DEFAULT_CONSOLE_TEXT = "等待任务输出...";

const STATUS_LABELS = {
  idle: "空闲",
  queued: "排队中",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
};

const STATUS_HINTS = {
  idle: "提交工单后，监控页会持续刷新状态和日志。",
  queued: "任务已经进入队列，系统正在准备执行环境。",
  running: "脚本正在执行，实时输出会持续写入监控页。",
  succeeded: "离线构建已完成，可以直接下载产物。",
  failed: "任务执行失败，请检查日志输出和输入参数。",
};

const SOURCE_LABELS = {
  local: "本地上传",
  github: "GitHub 发布包",
  market: "插件市场",
};

const PAGE_META = {
  overview: {
    eyebrow: "系统总览",
    title: "系统总览",
    description: "集中展示系统入口、运行态和最近工单，但不再把提交、监控、签名全部塞到一张长页面里。",
  },
  build: {
    eyebrow: "任务创建",
    title: "创建任务",
    description: "这一页只负责提交离线打包工单，表单保持紧凑，避免日志和治理信息挤占视线。",
  },
  monitor: {
    eyebrow: "任务监控",
    title: "任务监控",
    description: "把状态、日志、产物和历史工单拆到独立监控页，只保留运行反馈。",
  },
  signing: {
    eyebrow: "签名治理",
    title: "签名中心",
    description: "托管密钥、信任链和运行能力检查全部集中在这一页，明确区分管理员动作与普通用户动作。",
  },
};

const pageNodes = document.querySelectorAll(".page");
const pageToggleNodes = document.querySelectorAll("[data-page-target]");
const statusHintNodes = document.querySelectorAll('[data-role="status-hint"]');

const pageEyebrow = document.getElementById("pageEyebrow");
const pageTitle = document.getElementById("pageTitle");
const pageDescription = document.getElementById("pageDescription");

const sourceInput = document.getElementById("sourceInput");
const archInput = document.getElementById("archInput");
const signOutputInput = document.getElementById("signOutputInput");
const packageFile = document.getElementById("packageFile");
const fileHint = document.getElementById("fileHint");
const strategyCard = document.getElementById("strategyCard");
const compatibilityHint = document.getElementById("compatibilityHint");
const signingConfigHint = document.getElementById("signingConfigHint");
const signatureModeHint = document.getElementById("signatureModeHint");
const signaturePrivateKey = document.getElementById("signaturePrivateKey");
const signaturePublicKey = document.getElementById("signaturePublicKey");
const signaturePrivateKeyHint = document.getElementById("signaturePrivateKeyHint");
const signaturePublicKeyHint = document.getElementById("signaturePublicKeyHint");
const verificationNotice = document.getElementById("verificationNotice");
const submitButton = document.getElementById("submitButton");
const jobForm = document.getElementById("jobForm");
const buildSourceBadge = document.getElementById("buildSourceBadge");
const buildArchBadge = document.getElementById("buildArchBadge");
const signModeBadge = document.getElementById("signModeBadge");
const buildDispatchSummary = document.getElementById("buildDispatchSummary");

const consoleOutput = document.getElementById("consoleOutput");
const clearConsoleButton = document.getElementById("clearConsoleButton");
const refreshJobsButton = document.getElementById("refreshJobsButton");
const jobsList = document.getElementById("jobsList");
const overviewJobsList = document.getElementById("overviewJobsList");
const jobIdentity = document.getElementById("jobIdentity");
const jobStatus = document.getElementById("jobStatus");
const jobSource = document.getElementById("jobSource");
const jobUpdatedAt = document.getElementById("jobUpdatedAt");
const artifactName = document.getElementById("artifactName");
const artifactLink = document.getElementById("artifactLink");
const monitorStatusHeadline = document.getElementById("monitorStatusHeadline");
const monitorStrategyHeadline = document.getElementById("monitorStrategyHeadline");
const monitorStrategyText = document.getElementById("monitorStrategyText");

const hostArchChip = document.getElementById("hostArchChip");
const hostOsChip = document.getElementById("hostOsChip");
const mirrorChip = document.getElementById("mirrorChip");

const overviewCurrentJobId = document.getElementById("overviewCurrentJobId");
const overviewCurrentJobStatus = document.getElementById("overviewCurrentJobStatus");
const overviewCurrentJobMeta = document.getElementById("overviewCurrentJobMeta");
const overviewArtifactName = document.getElementById("overviewArtifactName");
const overviewArtifactLink = document.getElementById("overviewArtifactLink");
const overviewRuntimeValue = document.getElementById("overviewRuntimeValue");
const overviewRuntimeMeta = document.getElementById("overviewRuntimeMeta");
const overviewSigningValue = document.getElementById("overviewSigningValue");
const overviewSigningMeta = document.getElementById("overviewSigningMeta");
const overviewLaneValue = document.getElementById("overviewLaneValue");
const overviewLaneMeta = document.getElementById("overviewLaneMeta");
const overviewActivityValue = document.getElementById("overviewActivityValue");
const overviewActivityMeta = document.getElementById("overviewActivityMeta");
const overviewManagedKeySummary = document.getElementById("overviewManagedKeySummary");

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

const signingRuntimeValue = document.getElementById("signingRuntimeValue");
const signingRuntimeHint = document.getElementById("signingRuntimeHint");
const signingCliValue = document.getElementById("signingCliValue");
const signingCliHint = document.getElementById("signingCliHint");
const signingOpenSslValue = document.getElementById("signingOpenSslValue");
const signingOpenSslHint = document.getElementById("signingOpenSslHint");
const signingDefaultValue = document.getElementById("signingDefaultValue");
const signingDefaultHint = document.getElementById("signingDefaultHint");
const signingAdminAdvice = document.getElementById("signingAdminAdvice");
const signingUserAdvice = document.getElementById("signingUserAdvice");

const uploadDropzone = document.querySelector(".upload-dropzone");

let currentPage = "overview";
let currentSource = "local";
let currentArch = "amd64";
let currentSignOutput = false;
let currentJobId = null;
let currentJobStatus = "idle";
let currentJobSnapshot = null;
let currentEventSource = null;
let latestJobs = [];
let appConfig = null;
let isSubmitting = false;
let isGeneratingManagedKeys = false;

function normalizePage(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return PAGE_META[normalized] ? normalized : "overview";
}

function applyPage(page) {
  currentPage = normalizePage(page);
  const meta = PAGE_META[currentPage];

  pageEyebrow.textContent = meta.eyebrow;
  pageTitle.textContent = meta.title;
  pageDescription.textContent = meta.description;
  document.body.dataset.page = currentPage;

  pageNodes.forEach((node) => {
    node.classList.toggle("is-active", node.dataset.page === currentPage);
  });

  pageToggleNodes.forEach((node) => {
    const active = node.dataset.pageTarget === currentPage;
    node.classList.toggle("is-active", active);
    node.setAttribute("aria-current", active ? "page" : "false");
  });
}

function navigateToPage(page) {
  const normalized = normalizePage(page);
  const nextHash = `#${normalized}`;

  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }

  applyPage(normalized);
}

function syncPageFromHash() {
  applyPage(normalizePage(window.location.hash.replace(/^#/, "")));
}

function setStatusHint(text) {
  const message = text || STATUS_HINTS.idle;
  statusHintNodes.forEach((node) => {
    node.textContent = message;
  });
}

function setLinkState(link, enabled, href = "#", downloadName = "") {
  if (!link) {
    return;
  }

  if (enabled) {
    link.href = href;
    link.classList.remove("is-disabled");
    link.setAttribute("aria-disabled", "false");
    if (downloadName) {
      link.setAttribute("download", downloadName);
    } else {
      link.removeAttribute("download");
    }
    return;
  }

  link.href = "#";
  link.classList.add("is-disabled");
  link.setAttribute("aria-disabled", "true");
  link.removeAttribute("download");
}

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
    return new URL(value).host;
  } catch {
    return value;
  }
}

function formatHostOsLabel(value) {
  if (!value) {
    return "未知";
  }

  const normalized = String(value).toLowerCase();

  if (normalized === "linux") {
    return "Linux";
  }
  if (normalized === "windows") {
    return "Windows";
  }
  if (normalized === "darwin") {
    return "macOS";
  }

  return value;
}

function formatKeySourceLabel(value) {
  const normalized = String(value || "").toLowerCase();

  if (!normalized || normalized === "none") {
    return "未启用";
  }
  if (normalized === "env") {
    return "环境变量";
  }
  if (normalized === "managed") {
    return "托管密钥";
  }
  if (normalized === "uploaded") {
    return "临时上传";
  }
  if (normalized === "env_invalid") {
    return "环境变量异常";
  }

  return value;
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

function primaryJobSnapshot() {
  return latestJobs.find((item) => item.status === "queued" || item.status === "running")
    || latestJobs[0]
    || currentJobSnapshot
    || null;
}

function latestArtifactSnapshot() {
  return latestJobs.find((item) => item.artifact_name && item.id)
    || (currentJobSnapshot?.artifact_name ? currentJobSnapshot : null);
}

function buildCompatibilityHint() {
  if (!appConfig) {
    return "正在检测运行环境...";
  }

  if (appConfig.host_os !== "linux") {
    return `当前主机为 ${formatHostOsLabel(appConfig.host_os)} / ${appConfig.host_arch}。界面仍可使用，但打包命令只能在 Linux 运行。`;
  }

  if (appConfig.host_arch === "arm64") {
    return "当前主机为 arm64，只支持原生 arm64 打包，不支持反向生成 amd64。";
  }

  return "当前主机为 amd64，可直接执行 amd64 打包，也可走 amd64 -> arm64 的转换链路。";
}

function buildSigningConfigHint() {
  if (!appConfig) {
    return "正在检测签名运行态...";
  }

  const signing = signingConfig();
  const privateKeyState = signing.active_private_key_configured
    ? `当前私钥：${signing.active_private_key_name}（${signing.active_private_key_source}）。`
    : signing.server_private_key_error
      ? `私钥配置异常：${signing.server_private_key_error}。`
      : "当前没有可用私钥。";

  const publicKeyState = signing.active_public_key_configured
    ? `当前公钥：${signing.active_public_key_name}（${signing.active_public_key_source}）。`
    : signing.server_public_key_error
      ? `公钥配置异常：${signing.server_public_key_error}。`
      : "当前没有可用公钥。";

  const cliState = signatureCliSupported()
    ? `当前命令行工具 ${signatureCliStatus().binary_name || ""} 支持插件签名。`.trim()
    : signatureCliStatus().error || "当前命令行工具暂不支持插件签名。";

  return `${privateKeyState} ${publicKeyState} ${cliState}`;
}

function buildDispatchSummaryText() {
  const sourceText = formatSourceText(currentSource);
  const signText = currentSignOutput ? "输出将尝试签名" : "输出保持未签名";
  const strategyText = strategyCard.textContent || "等待运行策略";
  const selectedFile = currentSource === "local" ? packageFile.files?.[0]?.name : "";

  if (selectedFile) {
    return `${sourceText} · ${selectedFile} · ${currentArch} · ${signText}。${strategyText}`;
  }

  return `${sourceText} · ${currentArch} · ${signText}。${strategyText}`;
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
  const next = current && current !== DEFAULT_CONSOLE_TEXT ? `${current}\n${line}` : line;
  consoleOutput.textContent = next.trim();
  consoleOutput.scrollTop = consoleOutput.scrollHeight;
}

function updateFileHint() {
  const selectedName = packageFile.files?.[0]?.name;
  fileHint.textContent = selectedName || "仅在本地上传模式下使用";
  uploadDropzone?.classList.toggle("is-filled", Boolean(selectedName));
}

function updateHostSignals() {
  if (!appConfig) {
    return;
  }

  hostArchChip.textContent = `运行架构 ${appConfig.host_arch}`;
  hostOsChip.textContent = `${formatHostOsLabel(appConfig.host_os)} 主机`;
  mirrorChip.textContent = `镜像 ${simplifyUrl(appConfig.pip_mirror_url)}`;
  mirrorChip.title = appConfig.pip_mirror_url;
  compatibilityHint.textContent = buildCompatibilityHint();
}

function updateSystemPanels() {
  if (!appConfig) {
    return;
  }

  const managed = managedKeyPair();

  overviewRuntimeValue.textContent = `${formatHostOsLabel(appConfig.host_os)} / ${appConfig.host_arch}`;
  overviewRuntimeMeta.textContent = `PIP 镜像：${simplifyUrl(appConfig.pip_mirror_url)}`;

  if (signatureCliSupported() && canSignInCurrentRuntime()) {
    overviewSigningValue.textContent = managed.configured ? "托管签名就绪" : "签名就绪";
  } else if (signatureCliSupported()) {
    overviewSigningValue.textContent = "等待私钥";
  } else {
    overviewSigningValue.textContent = "命令行不支持";
  }

  overviewSigningMeta.textContent = managed.configured
    ? `公钥指纹：${managed.public_key_fingerprint || "-"}`
    : buildSigningConfigHint();

  if (appConfig.host_os !== "linux") {
    overviewLaneValue.textContent = "仅界面模式";
  } else if (appConfig.host_arch === "amd64") {
    overviewLaneValue.textContent = "双通道执行";
  } else {
    overviewLaneValue.textContent = "arm64 原生";
  }

  overviewLaneMeta.textContent = buildCompatibilityHint();
  overviewManagedKeySummary.textContent = managed.configured
    ? `托管密钥已在 ${formatDate(managed.generated_at)} 生成。下载公钥后，需要同步到 Dify 的签名信任链。`
    : "尚未生成托管密钥。建议管理员先在本页生成一对密钥，再开放签名输出给普通用户。";

  if (hasServerPrivateKey() && hasServerPublicKey()) {
    signingRuntimeValue.textContent = "服务端密钥完整";
  } else if (hasServerPrivateKey()) {
    signingRuntimeValue.textContent = "仅私钥可用";
  } else {
    signingRuntimeValue.textContent = "未配置密钥";
  }

  signingRuntimeHint.textContent = buildSigningConfigHint();
  signingCliValue.textContent = signatureCliSupported() ? "命令行支持签名" : "命令行需升级";
  signingCliHint.textContent = signatureCliSupported()
    ? `当前二进制：${signatureCliStatus().binary_name || "dify"}。`
    : signatureCliStatus().error || "当前运行环境无法执行插件签名。";

  signingOpenSslValue.textContent = opensslStatus().available ? "OpenSSL 就绪" : "OpenSSL 缺失";
  signingOpenSslHint.textContent = opensslStatus().available
    ? "可以在服务端生成和轮换托管密钥。"
    : opensslStatus().error || "当前服务端无法生成托管密钥。";

  signingDefaultValue.textContent = signingConfig().enabled_by_default ? "默认开启签名" : "默认保持未签名";
  signingDefaultHint.textContent = signingConfig().enabled_by_default
    ? "创建任务页会默认预选“签名输出”，仍可按工单手动切换。"
    : "创建任务页默认不签名，可在单次任务内手动开启。";

  signingAdminAdvice.textContent = managed.configured
    ? "托管密钥已经存在。下一步重点确认公钥已经写入 Dify 信任链，以及当前激活来源是否确实指向托管密钥。"
    : "先确认 OpenSSL 可用，再生成托管密钥并下载公钥。完成 Dify 侧信任登记后，再开放签名输出。";

  signingUserAdvice.textContent = managed.configured && signatureCliSupported()
    ? "如果管理员已经完成托管密钥和信任链配置，普通用户只需要在创建任务页勾选“签名输出”，无需上传一次性密钥。"
    : "如果管理员还没完成托管密钥配置，普通用户只能保持未签名，或在本次工单中临时上传一次性私钥。";
}

function updateOverviewJobSummary() {
  const primary = primaryJobSnapshot();

  if (primary) {
    overviewCurrentJobId.textContent = primary.id;
    overviewCurrentJobStatus.textContent = formatStatusText(primary.status);
    overviewCurrentJobStatus.className = formatStatusClass(primary.status);
    overviewCurrentJobMeta.textContent = `${formatSourceText(primary.source)} / ${primary.target_arch || "-"} · ${formatDate(primary.updated_at || primary.created_at)}`;
  } else {
    overviewCurrentJobId.textContent = "暂无工单";
    overviewCurrentJobStatus.textContent = STATUS_LABELS.idle;
    overviewCurrentJobStatus.className = formatStatusClass("idle");
    overviewCurrentJobMeta.textContent = "提交第一个任务后，这里会显示最新状态和更新时间。";
  }

  const artifactSnapshot = latestArtifactSnapshot();
  overviewArtifactName.textContent = artifactSnapshot?.artifact_name || "暂无可下载产物";
  setLinkState(
    overviewArtifactLink,
    Boolean(artifactSnapshot?.artifact_name && artifactSnapshot?.id),
    artifactSnapshot ? `/api/jobs/${artifactSnapshot.id}/download` : "#",
    artifactSnapshot?.artifact_name || "",
  );

  if (latestJobs.length) {
    overviewActivityValue.textContent = `${latestJobs.length} 条最近工单`;
    overviewActivityMeta.textContent = `最近更新：${formatDate(latestJobs[0].updated_at || latestJobs[0].created_at)}`;
  } else {
    overviewActivityValue.textContent = "尚无工单";
    overviewActivityMeta.textContent = "创建第一条离线打包任务后，这里会显示最近 20 条记录。";
  }
}

function createEmptyJobNode(className, titleText, metaText) {
  const wrapper = document.createElement("div");
  wrapper.className = `${className} ${className}--empty`;

  const title = document.createElement("div");
  title.className = `${className}__title`;
  title.textContent = titleText;

  const meta = document.createElement("div");
  meta.className = `${className}__meta`;
  meta.textContent = metaText;

  wrapper.append(title, meta);
  return wrapper;
}

function createJobNode(item, compact = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `${compact ? "job-mini" : "recent-job"}${item.id === currentJobId ? " is-active" : ""}`;
  button.dataset.jobId = item.id;

  const head = document.createElement("div");
  head.className = compact ? "job-mini__head" : "recent-job__head";

  const title = document.createElement("div");
  title.className = compact ? "job-mini__title" : "recent-job__title";
  title.textContent = item.id;

  const pill = document.createElement("div");
  pill.className = formatStatusClass(item.status);
  pill.textContent = formatStatusText(item.status);
  pill.title = item.status || "idle";

  head.append(title, pill);

  const meta = document.createElement("div");
  meta.className = compact ? "job-mini__meta" : "recent-job__meta";
  meta.textContent = item.source_summary || `${formatSourceText(item.source)} / ${item.target_arch || "-"}`;

  const submeta = document.createElement("div");
  submeta.className = compact ? "job-mini__submeta" : "recent-job__submeta";

  const route = document.createElement("span");
  route.textContent = `${formatSourceText(item.source)} / ${item.target_arch || "-"}`;

  const created = document.createElement("span");
  created.textContent = formatDate(item.created_at);

  submeta.append(route, created);
  button.append(head, meta, submeta);
  return button;
}

function renderJobCollection(container, items, { compact = false } = {}) {
  container.replaceChildren();

  if (!items.length) {
    container.append(
      compact
        ? createEmptyJobNode("job-mini", "暂无工单", "提交第一条任务后，这里会显示最近状态。")
        : createEmptyJobNode("recent-job", "暂无工单", "提交第一条任务后，这里会出现最近 20 条记录。"),
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  const limit = compact ? 4 : items.length;

  items.slice(0, limit).forEach((item) => {
    fragment.append(createJobNode(item, compact));
  });

  container.append(fragment);
}

function renderJobCollections() {
  renderJobCollection(jobsList, latestJobs);
  renderJobCollection(overviewJobsList, latestJobs, { compact: true });
  updateOverviewJobSummary();
}

function updateStrategyHint() {
  if (!appConfig) {
    strategyCard.textContent = "正在读取运行策略...";
    return;
  }

  const hostArch = appConfig.host_arch;
  const hostOs = appConfig.host_os;

  if (hostOs !== "linux") {
    strategyCard.textContent = `当前主机为 ${formatHostOsLabel(hostOs)} / ${hostArch}。界面可用，但后端打包命令会在非 Linux 环境失败。`;
  } else if (currentArch === "arm64" && hostArch !== "arm64") {
    strategyCard.textContent = `当前主机为 ${hostArch}，目标为 arm64。系统会走 amd64 -> arm64 的跨架构脚本链路。`;
  } else {
    strategyCard.textContent = `当前主机为 ${hostArch}，目标为 ${currentArch}。系统会使用标准重打包脚本。`;
  }

  if (!currentJobSnapshot) {
    monitorStrategyHeadline.textContent = `${formatSourceText(currentSource)} / ${currentArch}`;
    monitorStrategyText.textContent = strategyCard.textContent;
  }
}

function updateArchAvailability() {
  let fallbackArch = null;

  document.querySelectorAll("#archSwitch .segment-control__item").forEach((button) => {
    const unsupported = isTargetUnsupported(button.dataset.arch);
    button.disabled = unsupported;
    button.classList.toggle("is-disabled", unsupported);
    button.title = unsupported ? "当前主机不支持该目标架构。" : "";

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

function renderManagedKeyPanel() {
  const managed = managedKeyPair();
  const activeSource = signingConfig().active_private_key_source || "none";

  managedKeyHeadline.textContent = managed.configured ? "托管签名密钥已就绪" : "尚未生成托管密钥";
  managedKeyStatus.textContent = managed.configured
    ? "这组密钥保存在打包服务中。下载公钥、写入 Dify 信任链后，普通用户就能直接在创建任务页选择“签名输出”。"
    : "先在本页生成托管密钥，再把下载到的公钥加入 Dify 的签名信任链。";

  managedKeyGeneratedAt.textContent = formatDate(managed.generated_at);
  managedKeyFingerprint.textContent = managed.public_key_fingerprint || "-";

  managedKeySourceChip.textContent = `来源 ${formatKeySourceLabel(activeSource)}`;
  managedKeyCliChip.textContent = signatureCliSupported()
    ? `CLI ${signatureCliStatus().binary_name || "已就绪"}`
    : "命令行需升级";
  managedKeyOpenSslChip.textContent = opensslStatus().available ? "OpenSSL 已就绪" : "OpenSSL 缺失";

  generateManagedKeyButton.textContent = isGeneratingManagedKeys
    ? "生成中..."
    : managed.configured
      ? "轮换密钥对"
      : "生成密钥对";
  generateManagedKeyButton.disabled = isGeneratingManagedKeys || !opensslStatus().available;
  downloadManagedPublicKeyButton.disabled = !managed.configured;
  downloadManagedPrivateKeyButton.disabled = !managed.configured;

  if (!opensslStatus().available) {
    managedKeyActionHint.textContent = opensslStatus().error || "当前运行环境缺少 OpenSSL，无法生成托管密钥。";
  } else if (!managed.configured) {
    managedKeyActionHint.textContent = "管理员先在这里生成密钥，再把公钥写入 Dify 信任链。之后普通用户只需在创建任务页提交工单。";
  } else if (activeSource === "env" || activeSource === "env_invalid") {
    managedKeyActionHint.textContent = "托管密钥已经存在，但当前激活来源仍是环境变量配置，托管密钥尚未接管签名。";
  } else if (!signatureCliSupported()) {
    managedKeyActionHint.textContent = signatureCliStatus().error || "托管密钥已经就绪，但当前 CLI 还不支持插件签名。";
  } else {
    managedKeyActionHint.textContent = "托管密钥已处于可用状态。确认 Dify 已信任该公钥后，普通用户就可以直接提交签名工单。";
  }
}

function updateSignatureHints() {
  const privateKeyName = signaturePrivateKey.files?.[0]?.name;
  const publicKeyName = signaturePublicKey.files?.[0]?.name;
  const signing = signingConfig();

  signaturePrivateKeyHint.textContent = privateKeyName
    ? `本次工单会使用上传的私钥：${privateKeyName}。`
    : hasServerPrivateKey()
      ? `无需上传。当前激活私钥为 ${signing.active_private_key_name}（${signing.active_private_key_source}）。`
      : "高级覆盖：仅在不想使用托管密钥时，再为本次工单上传一次性私钥。";

  signaturePublicKeyHint.textContent = publicKeyName
    ? `本次工单会使用上传的公钥做本地校验：${publicKeyName}。`
    : hasServerPublicKey()
      ? `无需上传。当前激活公钥为 ${signing.active_public_key_name}（${signing.active_public_key_source}）。`
      : "高级覆盖：只有想让本地校验使用不同公钥时才上传。";

  if (!currentSignOutput) {
    signatureModeHint.textContent = "未签名包仍可生成，但若 Dify 开启签名校验，安装时会被拒绝。";
  } else if (!signatureCliSupported()) {
    signatureModeHint.textContent = signatureCliStatus().error || "已开启签名输出，但当前 CLI 还不支持插件签名。";
  } else if (hasUploadedPrivateKey()) {
    signatureModeHint.textContent = `本次工单会使用上传私钥 ${privateKeyName} 进行签名。`;
  } else if (hasServerPrivateKey()) {
    signatureModeHint.textContent = `本次工单会使用 ${signing.active_private_key_name}（${signing.active_private_key_source}）进行签名。`;
  } else {
    signatureModeHint.textContent = "已开启签名输出，但当前没有可用私钥。请生成托管密钥，或上传一次性私钥。";
  }

  signingConfigHint.textContent = buildSigningConfigHint();

  if (hasUploadedPublicKey()) {
    verificationNotice.innerHTML =
      `后端会使用 <code>${escapeHtml(publicKeyName)}</code> 做本地验签，但 Dify 仍需要把相同公钥加入 <code>THIRD_PARTY_SIGNATURE_VERIFICATION_PUBLIC_KEYS</code>。`;
  } else if (hasServerPublicKey()) {
    verificationNotice.innerHTML =
      `后端会使用 <code>${escapeHtml(signing.active_public_key_name)}</code>（${escapeHtml(signing.active_public_key_source)}）做本地验签，但 Dify 仍需要信任相同公钥。`;
  } else {
    verificationNotice.innerHTML =
      "如果 Dify 开启签名校验，必须把对应公钥加入 <code>THIRD_PARTY_SIGNATURE_VERIFICATION_PUBLIC_KEYS</code>。";
  }

  updateSystemPanels();
  updateBuildSummary();
  syncSubmitState();
}

function updateBuildSummary() {
  buildSourceBadge.textContent = formatSourceText(currentSource);
  buildArchBadge.textContent = currentArch;
  signModeBadge.textContent = currentSignOutput ? "签名输出" : "未签名";
  buildDispatchSummary.textContent = buildDispatchSummaryText();

  if (!currentJobSnapshot) {
    monitorStrategyHeadline.textContent = `${formatSourceText(currentSource)} / ${currentArch}`;
    monitorStrategyText.textContent = strategyCard.textContent || "等待运行策略";
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
  updateBuildSummary();
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
  updateBuildSummary();
  syncSubmitState();
}

function renderJobState(snapshot) {
  currentJobSnapshot = snapshot;
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

  artifactName.textContent = snapshot.artifact_name || "暂无产物";
  setLinkState(
    artifactLink,
    Boolean(snapshot.artifact_name && snapshot.id),
    snapshot.id ? `/api/jobs/${snapshot.id}/download` : "#",
    snapshot.artifact_name || "",
  );

  monitorStatusHeadline.textContent = snapshot.id
    ? `${formatStatusText(snapshot.status)} · ${snapshot.id}`
    : "等待任务";
  monitorStrategyHeadline.textContent = snapshot.source
    ? `${formatSourceText(snapshot.source)} / ${snapshot.target_arch || "-"}`
    : "待选择";
  monitorStrategyText.textContent = snapshot.source_summary || strategyCard.textContent || "等待运行策略";

  setStatusHint(snapshot.error || STATUS_HINTS[snapshot.status] || STATUS_HINTS.idle);
  syncSubmitState();
  renderJobCollections();
}

async function loadConfig() {
  const response = await fetch("/api/config");

  if (!response.ok) {
    throw new Error("加载运行配置失败");
  }

  appConfig = await response.json();
  appConfig.signing = appConfig.signing || {};

  updateHostSignals();
  renderManagedKeyPanel();
  updateSystemPanels();
  updateArchAvailability();
  setSignOutput(Boolean(signingConfig().enabled_by_default));
  updateStrategyHint();
  updateSignatureHints();
}

async function loadJobs() {
  const response = await fetch("/api/jobs");

  if (!response.ok) {
    throw new Error("加载工单列表失败");
  }

  const payload = await response.json();
  latestJobs = payload.items || [];
  renderJobCollections();
  return latestJobs;
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
  navigateToPage("monitor");

  const response = await fetch(`/api/jobs/${jobId}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.detail || "加载工单详情失败");
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
  setStatusHint("工单已提交，正在启动执行线程...");

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
    appendLog("[deck] 工单已创建，正在连接实时输出流。");
    isSubmitting = false;
    syncSubmitState();

    navigateToPage("monitor");
    openJobStream(payload.id);
    loadJobs().catch(() => {});
  } catch (error) {
    isSubmitting = false;
    syncSubmitState();
    setStatusHint(error.message);
    appendLog(`[deck] ${error.message}`);
  }
}

function applySigningConfig(signing) {
  appConfig = appConfig || {};
  appConfig.signing = signing || {};
  renderManagedKeyPanel();
  updateSignatureHints();
  updateSystemPanels();
}

function downloadManagedKey(kind) {
  window.location.href = `/api/signing/managed/download/${kind}`;
}

async function generateManagedKeyPair() {
  const overwrite = managedKeyPair().configured
    ? window.confirm("托管密钥已经存在。是否现在轮换？如果旧私钥还需要备份，请先下载。")
    : false;

  if (managedKeyPair().configured && !overwrite) {
    return;
  }

  isGeneratingManagedKeys = true;
  renderManagedKeyPanel();
  setStatusHint(overwrite ? "正在轮换托管密钥..." : "正在生成托管密钥...");

  try {
    const response = await fetch(`/api/signing/managed/generate?overwrite=${overwrite ? "true" : "false"}`, {
      method: "POST",
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.detail || "生成托管密钥失败");
    }

    applySigningConfig(payload.signing);

    if (!currentSignOutput && canSignInCurrentRuntime()) {
      setSignOutput(true);
    }

    const message = overwrite ? "托管密钥已轮换。" : "托管密钥已生成。";
    setStatusHint(message);
    appendLog(`[deck] ${message}`);
  } catch (error) {
    setStatusHint(error.message);
    appendLog(`[deck] ${error.message}`);
  } finally {
    isGeneratingManagedKeys = false;
    renderManagedKeyPanel();
  }
}

function handleJobListClick(event) {
  const card = event.target.closest("[data-job-id]");

  if (!card) {
    return;
  }

  inspectJob(card.dataset.jobId).catch((error) => {
    setStatusHint(error.message);
    appendLog(`[deck] ${error.message}`);
  });
}

pageToggleNodes.forEach((node) => {
  node.addEventListener("click", () => navigateToPage(node.dataset.pageTarget));
});

window.addEventListener("hashchange", syncPageFromHash);
window.addEventListener("beforeunload", closeStream);

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

packageFile.addEventListener("change", () => {
  updateFileHint();
  updateBuildSummary();
});

signaturePrivateKey.addEventListener("change", updateSignatureHints);
signaturePublicKey.addEventListener("change", updateSignatureHints);

generateManagedKeyButton.addEventListener("click", () => {
  generateManagedKeyPair().catch((error) => {
    setStatusHint(error.message);
    appendLog(`[deck] ${error.message}`);
  });
});

downloadManagedPublicKeyButton.addEventListener("click", () => downloadManagedKey("public"));
downloadManagedPrivateKeyButton.addEventListener("click", () => downloadManagedKey("private"));

clearConsoleButton.addEventListener("click", () => resetConsole());

refreshJobsButton.addEventListener("click", () => {
  loadJobs().catch((error) => {
    setStatusHint(error.message);
    appendLog(`[deck] ${error.message}`);
  });
});

jobsList.addEventListener("click", handleJobListClick);
overviewJobsList.addEventListener("click", handleJobListClick);
jobForm.addEventListener("submit", submitJob);

syncPageFromHash();
setSource(currentSource);
setArch(currentArch);
setSignOutput(currentSignOutput);
resetConsole();

Promise.all([loadConfig(), loadJobs()])
  .then(([, items]) => {
    if (!currentJobId && items.length) {
      return inspectJob(items[0].id);
    }

    renderJobCollections();
    return null;
  })
  .catch((error) => {
    consoleOutput.textContent = `[deck] 启动失败：${error.message}`;
    setStatusHint(error.message);
  });
