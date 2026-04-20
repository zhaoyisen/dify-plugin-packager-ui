from __future__ import annotations

import asyncio
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import urlopen

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
VENDOR_DIR = BASE_DIR / "vendor" / "dify-plugin-repackaging-plus"
DATA_DIR = BASE_DIR / "data"
JOBS_DIR = DATA_DIR / "jobs"

DEFAULT_PIP_MIRROR_URL = "https://mirrors.aliyun.com/pypi/simple"
DEFAULT_GITHUB_API_URL = "https://github.com"
DEFAULT_MARKETPLACE_API_URL = "https://marketplace.dify.ai"
FINAL_STATUSES = {"succeeded", "failed"}
SUPPORTED_SOURCES = {"local", "github", "market"}
SUPPORTED_ARCHES = {"amd64", "arm64"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_arch(value: str) -> str:
    raw = (value or "").lower()
    if raw in {"x86_64", "amd64"}:
        return "amd64"
    if raw in {"aarch64", "arm64"}:
        return "arm64"
    return raw or "unknown"


def safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return cleaned or f"plugin-{uuid.uuid4().hex[:8]}.difypkg"


def ensure_directories() -> None:
    for directory in (DATA_DIR, JOBS_DIR, VENDOR_DIR):
        directory.mkdir(parents=True, exist_ok=True)


@dataclass
class JobRecord:
    id: str
    source: str
    target_arch: str
    created_at: str
    source_summary: str
    status: str = "queued"
    updated_at: str = field(default_factory=now_iso)
    logs: list[str] = field(default_factory=list)
    artifact_name: str | None = None
    artifact_path: str | None = None
    error: str | None = None
    work_dir: str | None = None
    input_name: str | None = None
    meta: dict[str, str] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def log(self, message: str) -> None:
        line = message.rstrip()
        if not line:
            return
        with self.lock:
            self.logs.append(line)
            self.updated_at = now_iso()

    def transition(self, status: str, error: str | None = None) -> None:
        with self.lock:
            self.status = status
            self.error = error
            self.updated_at = now_iso()

    def set_artifact(self, path: Path) -> None:
        with self.lock:
            self.artifact_path = str(path)
            self.artifact_name = path.name
            self.updated_at = now_iso()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "id": self.id,
                "source": self.source,
                "target_arch": self.target_arch,
                "source_summary": self.source_summary,
                "status": self.status,
                "created_at": self.created_at,
                "updated_at": self.updated_at,
                "artifact_name": self.artifact_name,
                "artifact_path": self.artifact_path,
                "error": self.error,
                "input_name": self.input_name,
                "meta": dict(self.meta),
                "logs": list(self.logs),
            }


jobs: dict[str, JobRecord] = {}
jobs_lock = threading.Lock()
host_arch = normalize_arch(platform.machine())
host_os = platform.system().lower()


def get_job(job_id: str) -> JobRecord:
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def list_jobs() -> list[dict[str, Any]]:
    with jobs_lock:
        ordered = sorted(jobs.values(), key=lambda item: item.created_at, reverse=True)
    return [job.snapshot() for job in ordered[:20]]


def ensure_vendor_files() -> None:
    required = [
        "plugin_repackaging.sh",
        "plugin_repackaging_amd64_to_arm64.sh",
        "dify-plugin-linux-amd64-5g",
        "dify-plugin-linux-arm64-5g",
    ]
    missing = [name for name in required if not (VENDOR_DIR / name).exists()]
    if missing:
        raise RuntimeError(f"Vendor assets missing: {', '.join(missing)}")


def copy_runner_assets(job_dir: Path) -> Path:
    runner_dir = job_dir / "runner"
    runner_dir.mkdir(parents=True, exist_ok=True)
    for item in VENDOR_DIR.iterdir():
        if not item.is_file():
            continue
        target = runner_dir / item.name
        shutil.copy2(item, target)
        if target.suffix != ".md":
            target.chmod(target.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return runner_dir


def choose_script(target_arch: str) -> str:
    if target_arch == "arm64" and host_arch != "arm64":
        return "plugin_repackaging_amd64_to_arm64.sh"
    return "plugin_repackaging.sh"


def ensure_supported_target(target_arch: str) -> None:
    if host_arch == "arm64" and target_arch == "amd64":
        raise RuntimeError(
            "The current build host is arm64. This tool does not provide an arm64-to-amd64 repackaging script."
        )


def build_runtime_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PIP_MIRROR_URL"] = os.getenv("PIP_MIRROR_URL", DEFAULT_PIP_MIRROR_URL)
    env["GITHUB_API_URL"] = os.getenv("GITHUB_API_URL", DEFAULT_GITHUB_API_URL)
    env["MARKETPLACE_API_URL"] = os.getenv("MARKETPLACE_API_URL", DEFAULT_MARKETPLACE_API_URL)
    return env


def download_market_package(job: JobRecord, destination: Path) -> Path:
    author = job.meta["market_author"]
    plugin_name = job.meta["market_name"]
    version = job.meta["market_version"]
    marketplace_base = os.getenv("MARKETPLACE_API_URL", DEFAULT_MARKETPLACE_API_URL).rstrip("/")
    url = (
        f"{marketplace_base}/api/v1/plugins/"
        f"{quote(author)}/{quote(plugin_name)}/{quote(version)}/download"
    )
    job.log(f"[market] Downloading {url}")
    output_path = destination / f"{safe_filename(author)}-{safe_filename(plugin_name)}_{version}.difypkg"
    with urlopen(url, timeout=120) as response, output_path.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    job.log(f"[market] Saved package to {output_path.name}")
    return output_path


def find_output_package(runner_dir: Path) -> Path | None:
    packages = sorted(
        runner_dir.glob("*-offline.difypkg"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    return packages[0] if packages else None


def run_subprocess(job: JobRecord, command: list[str], cwd: Path, env: dict[str, str]) -> None:
    job.log(f"[exec] {' '.join(command)}")
    process = subprocess.Popen(
        command,
        cwd=str(cwd),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    assert process.stdout is not None
    for line in process.stdout:
        job.log(line)
    code = process.wait()
    if code != 0:
        raise RuntimeError(f"Packaging command failed with exit code {code}")


def execute_job(job: JobRecord) -> None:
    if host_os != "linux":
        raise RuntimeError("Packaging execution requires Linux because the bundled packager binaries are Linux ELF executables")
    ensure_supported_target(job.target_arch)

    job_dir = Path(job.work_dir or "")
    input_dir = job_dir / "input"
    output_dir = job_dir / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    runner_dir = copy_runner_assets(job_dir)
    env = build_runtime_env()
    script_name = choose_script(job.target_arch)
    script_path = runner_dir / script_name
    source_path: Path | None = None

    job.log(f"[job] Host architecture: {host_arch}")
    job.log(f"[job] Target architecture: {job.target_arch}")
    job.log(f"[job] Using script: {script_name}")
    job.log(f"[job] Working directory: {runner_dir}")

    if job.source == "market":
        source_path = download_market_package(job, input_dir)
        command = ["bash", str(script_path), "local", str(source_path)]
    elif job.source == "local":
        source_path = input_dir / (job.input_name or "")
        command = ["bash", str(script_path), "local", str(source_path)]
    else:
        command = [
            "bash",
            str(script_path),
            "github",
            job.meta["github_repo"],
            job.meta["github_release"],
            job.meta["github_asset"],
        ]

    run_subprocess(job, command, runner_dir, env)

    package = find_output_package(runner_dir)
    if not package:
        raise RuntimeError("Packaging finished but no offline package was generated")

    target_path = output_dir / package.name
    shutil.move(str(package), str(target_path))
    job.set_artifact(target_path)
    job.log(f"[done] Output package ready: {package.name}")


def background_job_runner(job_id: str) -> None:
    job = get_job(job_id)
    try:
        job.transition("running")
        execute_job(job)
        job.transition("succeeded")
    except Exception as exc:  # noqa: BLE001
        job.log(f"[error] {exc}")
        job.transition("failed", str(exc))


app = FastAPI(title="Dify Plugin Packager UI")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.on_event("startup")
def startup() -> None:
    ensure_directories()
    ensure_vendor_files()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/config")
async def config() -> JSONResponse:
    unsupported_pairs: list[dict[str, str]] = []
    if host_arch == "arm64":
        unsupported_pairs.append({"host_arch": "arm64", "target_arch": "amd64"})
    return JSONResponse(
        {
            "host_arch": host_arch,
            "host_os": host_os,
            "supported_sources": sorted(SUPPORTED_SOURCES),
            "supported_arches": sorted(SUPPORTED_ARCHES),
            "unsupported_pairs": unsupported_pairs,
            "pip_mirror_url": os.getenv("PIP_MIRROR_URL", DEFAULT_PIP_MIRROR_URL),
            "marketplace_api_url": os.getenv("MARKETPLACE_API_URL", DEFAULT_MARKETPLACE_API_URL),
            "github_api_url": os.getenv("GITHUB_API_URL", DEFAULT_GITHUB_API_URL),
        }
    )


@app.get("/api/jobs")
async def jobs_endpoint() -> JSONResponse:
    return JSONResponse({"items": list_jobs()})


@app.get("/api/jobs/{job_id}")
async def job_detail(job_id: str) -> JSONResponse:
    return JSONResponse(get_job(job_id).snapshot())


@app.get("/api/jobs/{job_id}/download")
async def job_download(job_id: str) -> FileResponse:
    job = get_job(job_id)
    snapshot = job.snapshot()
    if snapshot["status"] != "succeeded" or not snapshot["artifact_path"]:
        raise HTTPException(status_code=409, detail="Job output is not ready")
    artifact_path = Path(snapshot["artifact_path"])
    if not artifact_path.exists():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(artifact_path, filename=snapshot["artifact_name"])


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    job = get_job(job_id)

    async def event_stream() -> Any:
        cursor = 0
        while True:
            snapshot = job.snapshot()
            logs = snapshot["logs"]
            for line in logs[cursor:]:
                payload = json.dumps({"line": line}, ensure_ascii=False)
                yield f"event: log\ndata: {payload}\n\n"
            cursor = len(logs)

            state_payload = json.dumps(
                {
                    key: value
                    for key, value in snapshot.items()
                    if key != "logs"
                },
                ensure_ascii=False,
            )
            yield f"event: state\ndata: {state_payload}\n\n"

            if snapshot["status"] in FINAL_STATUSES:
                break
            await asyncio.sleep(0.8)

        yield "event: end\ndata: {}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/jobs")
async def create_job(
    source: str = Form(...),
    target_arch: str = Form(...),
    package_file: UploadFile | None = File(default=None),
    github_repo: str | None = Form(default=None),
    github_release: str | None = Form(default=None),
    github_asset: str | None = Form(default=None),
    market_author: str | None = Form(default=None),
    market_name: str | None = Form(default=None),
    market_version: str | None = Form(default=None),
) -> JSONResponse:
    source = source.strip().lower()
    target_arch = target_arch.strip().lower()
    if source not in SUPPORTED_SOURCES:
        raise HTTPException(status_code=400, detail="Unsupported source")
    if target_arch not in SUPPORTED_ARCHES:
        raise HTTPException(status_code=400, detail="Unsupported target architecture")
    if host_arch == "arm64" and target_arch == "amd64":
        raise HTTPException(
            status_code=400,
            detail="Current runtime is arm64. amd64 target is not supported by the bundled scripts.",
        )

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    meta: dict[str, str] = {}
    source_summary = ""
    input_name: str | None = None

    if source == "local":
        if not package_file or not package_file.filename:
            raise HTTPException(status_code=400, detail="Local package file is required")
        input_name = safe_filename(package_file.filename)
        target_path = input_dir / input_name
        with target_path.open("wb") as handle:
            while chunk := await package_file.read(1024 * 1024):
                handle.write(chunk)
        source_summary = input_name
    elif source == "github":
        missing = [
            name
            for name, value in {
                "github_repo": github_repo,
                "github_release": github_release,
                "github_asset": github_asset,
            }.items()
            if not value or not value.strip()
        ]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing fields: {', '.join(missing)}")
        meta = {
            "github_repo": github_repo.strip(),
            "github_release": github_release.strip(),
            "github_asset": github_asset.strip(),
        }
        source_summary = f"{meta['github_repo']} @ {meta['github_release']}"
    else:
        missing = [
            name
            for name, value in {
                "market_author": market_author,
                "market_name": market_name,
                "market_version": market_version,
            }.items()
            if not value or not value.strip()
        ]
        if missing:
            raise HTTPException(status_code=400, detail=f"Missing fields: {', '.join(missing)}")
        meta = {
            "market_author": market_author.strip(),
            "market_name": market_name.strip(),
            "market_version": market_version.strip(),
        }
        source_summary = (
            f"{meta['market_author']}/{meta['market_name']} @ {meta['market_version']}"
        )

    job = JobRecord(
        id=job_id,
        source=source,
        target_arch=target_arch,
        created_at=now_iso(),
        source_summary=source_summary,
        work_dir=str(job_dir),
        input_name=input_name,
        meta=meta,
    )
    job.log("[job] Created packaging job")

    with jobs_lock:
        jobs[job_id] = job

    worker = threading.Thread(target=background_job_runner, args=(job_id,), daemon=True)
    worker.start()

    return JSONResponse(job.snapshot(), status_code=201)
