const SOURCE_META = {
  local: {
    label: "本地包",
    caption: "将现成的 `.difypkg` 直接送入离线重打包通道。",
  },
  github: {
    label: "GitHub 发布包",
    caption: "先从发布资产抓取原包，再进入离线封装链路。",
  },
  market: {
    label: "插件市场",
    caption: "先从插件市场拉取原包，再落入统一的离线重打包出口。",
  },
};

const ROUTE_META = {
  amd64: {
    headline: "标准 amd64 通道",
    body: "宿主为 Linux / amd64，当前选择会直接进入本机重打包链路。",
    compatHeadline: "目标可立即发起",
    compatBody: "当前目标与宿主相容，不需要额外的跨架构准备。",
  },
  arm64: {
    headline: "跨架构 arm64 通道",
    body: "宿主仍为 amd64，但当前目标会切入 amd64 -> arm64 的转换脚本链路。",
    compatHeadline: "需要跨架构封装",
    compatBody: "系统会预留转换步骤，中央工作区无需再展示复杂条件分支。",
  },
};

const SIGN_META = {
  managed: {
    label: "托管签名",
    headline: "托管签名已接管",
    body: "管理员已完成密钥预热，普通用户无需在主流程里再上传一次性私钥。",
  },
  unsigned: {
    label: "保持未签名",
    headline: "产物将保持未签名",
    body: "适用于只想先拿到离线包的场景，但如果目标环境强制验签，安装时会被拦截。",
  },
};

const ARTIFACT_COPY = {
  available: {
    headline: "可下载离线产物已存在",
    body: "market/agent@0.0.9 · offline-agent-arm64.difypkg",
  },
  pending: {
    headline: "产物槽位等待新工单覆盖",
    body: "这是一版静态原型，点击主按钮只演示提交前反馈，不会生成真实文件。",
  },
};

const SAMPLE_JOBS = [
  {
    id: "release-probe-9021",
    status: "running",
    source: "GitHub 发布包",
    arch: "arm64",
    sign: "托管签名",
    time: "刚刚",
    summary: "owner/repository @ v0.9.2",
    artifact: "当前为运行中工单，产物槽位尚未写入。",
    logs: [
      "[00:00] 任务进入执行栈，已锁定 GitHub 发布包来源。",
      "[00:01] 正在解析 release 资产清单。",
      "[00:03] 原始包抓取完成，开始写入离线封装工作目录。",
      "[00:06] 当前目标为 arm64，已切入跨架构封装链路。",
      "[00:09] 托管签名已预热，等待产物落盘后执行覆盖。",
    ],
  },
  {
    id: "market-fold-7614",
    status: "succeeded",
    source: "插件市场",
    arch: "amd64",
    sign: "托管签名",
    time: "2 分钟前",
    summary: "langgenius/agent @ 0.0.9",
    artifact: "offline-agent-amd64.difypkg 已进入归档区，可直接下载。",
    logs: [
      "[00:00] 已从插件市场拉取原始包。",
      "[00:02] 标准 amd64 通道开始重打包。",
      "[00:05] 产物文件落盘完成。",
      "[00:06] 托管签名覆盖成功。",
      "[00:07] 验签通过，产物已进入离线交付出口。",
    ],
  },
  {
    id: "local-slab-1148",
    status: "queued",
    source: "本地包",
    arch: "amd64",
    sign: "保持未签名",
    time: "7 分钟前",
    summary: "my-plugin.difypkg",
    artifact: "队列中的任务还没有进入产物阶段。",
    logs: [
      "[00:00] 本地包入口已记录文件名。",
      "[00:01] 当前任务仍在等待执行通道空闲。",
      "[00:02] 因为选择保持未签名，后续会跳过签名覆盖。",
    ],
  },
  {
    id: "arm-hotfix-3380",
    status: "failed",
    source: "本地包",
    arch: "arm64",
    sign: "托管签名",
    time: "13 分钟前",
    summary: "hotfix-plugin.difypkg",
    artifact: "上一次尝试在跨架构阶段中断，没有生成可回收产物。",
    logs: [
      "[00:00] 本地包入口完成接收。",
      "[00:02] 切入 amd64 -> arm64 转换链路。",
      "[00:05] 运行时样例提示：跨架构工具链异常，任务被中止。",
      "[00:05] 原型阶段只用于展示失败态，不代表真实后端错误。",
    ],
  },
];

const sourceInput = document.getElementById("sourceInput");
const archInput = document.getElementById("archInput");
const signInput = document.getElementById("signInput");
const sourceCaption = document.getElementById("sourceCaption");
const sourceButtons = document.querySelectorAll("[data-source]");
const sourcePanels = document.querySelectorAll("[data-source-panel]");
const archButtons = document.querySelectorAll("[data-arch]");
const signButtons = document.querySelectorAll("[data-sign]");
const summarySource = document.getElementById("summarySource");
const summaryArch = document.getElementById("summaryArch");
const summarySign = document.getElementById("summarySign");
const summaryNarrative = document.getElementById("summaryNarrative");
const routeHeadline = document.getElementById("routeHeadline");
const routeBody = document.getElementById("routeBody");
const compatHeadline = document.getElementById("compatHeadline");
const compatBody = document.getElementById("compatBody");
const signHeadline = document.getElementById("signHeadline");
const signBody = document.getElementById("signBody");
const artifactHeadline = document.getElementById("artifactHeadline");
const artifactBody = document.getElementById("artifactBody");
const artifactAction = document.getElementById("artifactAction");
const packageFile = document.getElementById("packageFile");
const packageFileName = document.getElementById("packageFileName");
const submitButton = document.getElementById("submitButton");
const activityJobs = document.getElementById("activityJobs");
const activityLogs = document.getElementById("activityLogs");
const artifactPreview = document.getElementById("artifactPreview");
const artifactPreviewTitle = document.getElementById("artifactPreviewTitle");
const artifactPreviewBody = document.getElementById("artifactPreviewBody");
const activityStatusLabel = document.getElementById("activityStatusLabel");
const activityStatusMeta = document.getElementById("activityStatusMeta");
const activityStatusDot = document.getElementById("activityStatusDot");
const consoleTabs = document.querySelectorAll("[data-console-view]");

let currentSource = sourceInput.value;
let currentArch = archInput.value;
let currentSign = signInput.value;
let activeJobId = SAMPLE_JOBS[0].id;
let consoleView = "logs";
let launchBusy = false;

function statusClass(status) {
  return `timeline-item__status timeline-item__status--${status}`;
}

function statusLabel(status) {
  if (status === "running") {
    return "执行中";
  }
  if (status === "queued") {
    return "排队中";
  }
  if (status === "succeeded") {
    return "已完成";
  }
  if (status === "failed") {
    return "失败";
  }
  return "空闲";
}

function statusColor(status) {
  if (status === "running") {
    return "#d8af6a";
  }
  if (status === "queued") {
    return "#8fa4b1";
  }
  if (status === "succeeded") {
    return "#83c59b";
  }
  if (status === "failed") {
    return "#dc796b";
  }
  return "#8fa4b1";
}

function activeJob() {
  return SAMPLE_JOBS.find((job) => job.id === activeJobId) || SAMPLE_JOBS[0];
}

function updateSourcePanels() {
  const meta = SOURCE_META[currentSource];

  sourceCaption.textContent = meta.caption;
  sourceInput.value = currentSource;

  sourceButtons.forEach((button) => {
    const active = button.dataset.source === currentSource;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  sourcePanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.sourcePanel === currentSource);
  });
}

function updateDispatchSummary() {
  const route = ROUTE_META[currentArch];
  const sign = SIGN_META[currentSign];
  const source = SOURCE_META[currentSource];

  summarySource.textContent = source.label;
  summaryArch.textContent = currentArch;
  summarySign.textContent = sign.label;
  summaryNarrative.textContent = `当前将以${source.label}为来源，走${route.headline}，并在出口阶段采用${sign.label}策略。`;

  routeHeadline.textContent = route.headline;
  routeBody.textContent = route.body;
  compatHeadline.textContent = route.compatHeadline;
  compatBody.textContent = route.compatBody;
  signHeadline.textContent = sign.headline;
  signBody.textContent = sign.body;
}

function updateControls() {
  archInput.value = currentArch;
  signInput.value = currentSign;

  archButtons.forEach((button) => {
    const active = button.dataset.arch === currentArch;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  signButtons.forEach((button) => {
    const active = button.dataset.sign === currentSign;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderActivityList() {
  activityJobs.replaceChildren();

  const fragment = document.createDocumentFragment();

  SAMPLE_JOBS.forEach((job) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `timeline-item${job.id === activeJobId ? " is-active" : ""}`;
    button.dataset.jobId = job.id;

    const head = document.createElement("div");
    head.className = "timeline-item__head";

    const title = document.createElement("strong");
    title.textContent = job.id;

    const status = document.createElement("span");
    status.className = statusClass(job.status);
    status.textContent = statusLabel(job.status);

    head.append(title, status);

    const copy = document.createElement("p");
    copy.textContent = job.summary;

    const meta = document.createElement("div");
    meta.className = "timeline-item__meta";

    const left = document.createElement("span");
    left.textContent = `${job.source} / ${job.arch} / ${job.sign}`;

    const right = document.createElement("span");
    right.textContent = job.time;

    meta.append(left, right);
    button.append(head, copy, meta);
    fragment.append(button);
  });

  activityJobs.append(fragment);
}

function renderActiveJob() {
  const job = activeJob();

  activityStatusLabel.textContent = `当前聚焦：${job.id}`;
  activityStatusMeta.textContent = `${job.source} / ${job.arch} / ${job.sign} / ${statusLabel(job.status)}`;
  activityStatusDot.style.background = statusColor(job.status);
  activityStatusDot.style.boxShadow = `0 0 0 8px color-mix(in srgb, ${statusColor(job.status)} 20%, transparent)`;

  activityLogs.textContent = job.logs.join("\n");
  artifactPreviewTitle.textContent = job.status === "succeeded" ? "offline-agent-amd64.difypkg" : `${job.id} 产物概况`;
  artifactPreviewBody.textContent = job.artifact;

  if (job.status === "succeeded") {
    artifactHeadline.textContent = ARTIFACT_COPY.available.headline;
    artifactBody.textContent = ARTIFACT_COPY.available.body;
  } else {
    artifactHeadline.textContent = ARTIFACT_COPY.pending.headline;
    artifactBody.textContent = job.artifact;
  }
}

function updateConsoleView() {
  const showLogs = consoleView === "logs";

  consoleTabs.forEach((button) => {
    const active = button.dataset.consoleView === consoleView;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  activityLogs.hidden = !showLogs;
  artifactPreview.hidden = showLogs;
}

function runPrototypeLaunch() {
  if (launchBusy) {
    return;
  }

  launchBusy = true;
  submitButton.classList.add("is-busy");

  const title = submitButton.querySelector(".launch-button__title");
  const meta = submitButton.querySelector(".launch-button__meta");
  const previousTitle = title.textContent;
  const previousMeta = meta.textContent;

  title.textContent = "舱内校验中";
  meta.textContent = "正在演示提交前扫描、路线确认和底部活动带联动。";

  setTimeout(() => {
    activeJobId = SAMPLE_JOBS[0].id;
    renderActivityList();
    renderActiveJob();
    consoleView = "logs";
    updateConsoleView();

    title.textContent = "原型预演完成";
    meta.textContent = "已展示任务发起前反馈。本轮不触发真实提交。";
  }, 950);

  setTimeout(() => {
    submitButton.classList.remove("is-busy");
    title.textContent = previousTitle;
    meta.textContent = previousMeta;
    launchBusy = false;
  }, 1800);
}

function initialize() {
  updateSourcePanels();
  updateControls();
  updateDispatchSummary();
  renderActivityList();
  renderActiveJob();
  updateConsoleView();
}

sourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentSource = button.dataset.source;
    updateSourcePanels();
    updateDispatchSummary();
  });
});

archButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentArch = button.dataset.arch;
    updateControls();
    updateDispatchSummary();
  });
});

signButtons.forEach((button) => {
  button.addEventListener("click", () => {
    currentSign = button.dataset.sign;
    updateControls();
    updateDispatchSummary();
  });
});

activityJobs.addEventListener("click", (event) => {
  const card = event.target.closest("[data-job-id]");

  if (!card) {
    return;
  }

  activeJobId = card.dataset.jobId;
  renderActivityList();
  renderActiveJob();
});

consoleTabs.forEach((button) => {
  button.addEventListener("click", () => {
    consoleView = button.dataset.consoleView;
    updateConsoleView();
  });
});

packageFile.addEventListener("change", () => {
  packageFileName.textContent = packageFile.files?.[0]?.name
    || "尚未选择文件，原型阶段只演示入口形态。";
});

submitButton.addEventListener("click", runPrototypeLaunch);
artifactAction.addEventListener("click", () => {
  consoleView = "artifact";
  updateConsoleView();
});

initialize();
