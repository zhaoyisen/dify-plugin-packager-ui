from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import subprocess
import threading
import uuid
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from urllib.request import urlopen

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
VENDOR_DIR = BASE_DIR / "vendor" / "dify-plugin-repackaging-plus"
DATA_DIR = BASE_DIR / "data"
JOBS_DIR = DATA_DIR / "jobs"
SIGNING_DIR = DATA_DIR / "signing"
MANAGED_SIGNING_DIR = SIGNING_DIR / "managed"

DEFAULT_PIP_MIRROR_URL = "https://mirrors.aliyun.com/pypi/simple"
DEFAULT_GITHUB_API_URL = "https://github.com"
DEFAULT_MARKETPLACE_API_URL = "https://marketplace.dify.ai"
SIGNING_PRIVATE_KEY_PATH_ENV = "PLUGIN_SIGNING_PRIVATE_KEY_PATH"
SIGNING_PUBLIC_KEY_PATH_ENV = "PLUGIN_SIGNING_PUBLIC_KEY_PATH"
MANAGED_PRIVATE_KEY_NAME = "packager-managed.private.pem"
MANAGED_PUBLIC_KEY_NAME = "packager-managed.public.pem"
MANAGED_SIGNING_METADATA_NAME = "metadata.json"
FINAL_STATUSES = {"succeeded", "failed"}
SUPPORTED_SOURCES = {"local", "github", "market"}
SUPPORTED_ARCHES = {"amd64", "arm64"}
TRUE_VALUES = {"1", "true", "yes", "on"}


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
    for directory in (DATA_DIR, JOBS_DIR, VENDOR_DIR, MANAGED_SIGNING_DIR):
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
    sign_output: bool = False
    signature_private_key_path: str | None = field(default=None, repr=False)
    signature_public_key_path: str | None = field(default=None, repr=False)
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
                "sign_output": self.sign_output,
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
        raise HTTPException(status_code=404, detail="任务不存在")
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
        raise RuntimeError(f"依赖资源缺失：{', '.join(missing)}")


def parse_form_bool(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in TRUE_VALUES


def env_path(env_name: str) -> Path | None:
    raw = (os.getenv(env_name) or "").strip()
    if not raw:
        return None
    return Path(raw).expanduser()


def describe_key_path(path: Path | None, *, show_name_only: bool = True) -> str:
    if not path:
        return "not configured"
    return path.name if show_name_only else str(path)


def managed_private_key_path() -> Path:
    return MANAGED_SIGNING_DIR / MANAGED_PRIVATE_KEY_NAME


def managed_public_key_path() -> Path:
    return MANAGED_SIGNING_DIR / MANAGED_PUBLIC_KEY_NAME


def managed_signing_metadata_path() -> Path:
    return MANAGED_SIGNING_DIR / MANAGED_SIGNING_METADATA_NAME


def json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def write_json_file(path: Path, payload: dict[str, Any]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


def file_sha256(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def summarize_managed_signing_key_pair() -> dict[str, Any]:
    private_key = managed_private_key_path()
    public_key = managed_public_key_path()
    metadata = json_file(managed_signing_metadata_path())
    ready = private_key.is_file() and public_key.is_file()

    return {
        "configured": ready,
        "private_key_name": private_key.name if private_key.is_file() else None,
        "public_key_name": public_key.name if public_key.is_file() else None,
        "generated_at": metadata.get("generated_at"),
        "algorithm": metadata.get("algorithm"),
        "private_key_format": metadata.get("private_key_format"),
        "public_key_format": metadata.get("public_key_format"),
        "public_key_fingerprint": file_sha256(public_key),
    }


def detect_signature_cli_status() -> dict[str, Any]:
    cli_path = VENDOR_DIR / host_cli_binary_name()
    if host_os != "linux":
        return {
            "supported": False,
            "binary_name": cli_path.name,
            "error": "The bundled signing binary only runs on Linux hosts.",
        }
    if not cli_path.is_file():
        return {
            "supported": False,
            "binary_name": cli_path.name,
            "error": f"{cli_path.name} is missing from vendor assets.",
        }

    try:
        result = subprocess.run(
            [str(cli_path), "--help"],
            cwd=str(VENDOR_DIR),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            check=False,
        )
    except FileNotFoundError:
        return {
            "supported": False,
            "binary_name": cli_path.name,
            "error": "The bundled signing binary could not be executed.",
        }
    except subprocess.TimeoutExpired:
        return {
            "supported": False,
            "binary_name": cli_path.name,
            "error": "Timed out while checking the bundled signing binary.",
        }

    help_text = f"{result.stdout}\n{result.stderr}"
    supports_signature = "signature" in help_text.lower()
    error = None
    if not supports_signature:
        error = (
            f"{cli_path.name} does not expose the `signature` command. "
            "Replace it with a newer Dify CLI build before enabling automatic signing."
        )

    return {
        "supported": supports_signature,
        "binary_name": cli_path.name,
        "error": error,
    }


def detect_openssl_status() -> dict[str, Any]:
    try:
        result = subprocess.run(
            ["openssl", "version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=15,
            check=False,
        )
    except FileNotFoundError:
        return {
            "available": False,
            "version": None,
            "error": "OpenSSL is not installed in the current runtime.",
        }
    except subprocess.TimeoutExpired:
        return {
            "available": False,
            "version": None,
            "error": "Timed out while checking OpenSSL.",
        }

    output = (result.stdout or result.stderr).strip()
    return {
        "available": result.returncode == 0,
        "version": output or None,
        "error": None if result.returncode == 0 else output or "OpenSSL returned a non-zero status.",
    }


def resolve_server_private_key_path() -> tuple[Path | None, str]:
    env_private_key = env_path(SIGNING_PRIVATE_KEY_PATH_ENV)
    if env_private_key:
        if env_private_key.is_file():
            return env_private_key, "env"
        return None, "env_invalid"

    managed_private_key = managed_private_key_path()
    if managed_private_key.is_file():
        return managed_private_key, "managed"
    return None, "none"


def resolve_server_public_key_path() -> tuple[Path | None, str]:
    env_public_key = env_path(SIGNING_PUBLIC_KEY_PATH_ENV)
    if env_public_key:
        if env_public_key.is_file():
            return env_public_key, "env"
        return None, "env_invalid"

    managed_public_key = managed_public_key_path()
    if managed_public_key.is_file():
        return managed_public_key, "managed"
    return None, "none"


def get_signing_runtime_config() -> dict[str, Any]:
    private_key_path = env_path(SIGNING_PRIVATE_KEY_PATH_ENV)
    public_key_path = env_path(SIGNING_PUBLIC_KEY_PATH_ENV)
    private_key_ready = bool(private_key_path and private_key_path.is_file())
    public_key_ready = bool(public_key_path and public_key_path.is_file())
    managed_key_state = summarize_managed_signing_key_pair()
    active_private_key_path, active_private_key_source = resolve_server_private_key_path()
    active_public_key_path, active_public_key_source = resolve_server_public_key_path()
    signature_cli = detect_signature_cli_status()
    openssl_status = detect_openssl_status()

    return {
        "enabled_by_default": bool(active_private_key_path) and signature_cli["supported"],
        "server_private_key_configured": private_key_ready,
        "server_private_key_name": private_key_path.name if private_key_ready else None,
        "server_private_key_error": (
            f"{private_key_path} does not exist"
            if private_key_path and not private_key_ready
            else None
        ),
        "server_private_key_env": SIGNING_PRIVATE_KEY_PATH_ENV,
        "server_public_key_configured": public_key_ready,
        "server_public_key_name": public_key_path.name if public_key_ready else None,
        "server_public_key_error": (
            f"{public_key_path} does not exist"
            if public_key_path and not public_key_ready
            else None
        ),
        "server_public_key_env": SIGNING_PUBLIC_KEY_PATH_ENV,
        "managed_key_pair": managed_key_state,
        "active_private_key_configured": bool(active_private_key_path),
        "active_private_key_name": active_private_key_path.name if active_private_key_path else None,
        "active_private_key_source": active_private_key_source,
        "active_public_key_configured": bool(active_public_key_path),
        "active_public_key_name": active_public_key_path.name if active_public_key_path else None,
        "active_public_key_source": active_public_key_source,
        "signature_cli": signature_cli,
        "openssl": openssl_status,
    }


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


def host_cli_binary_name() -> str:
    if host_arch == "arm64":
        return "dify-plugin-linux-arm64-5g"
    return "dify-plugin-linux-amd64-5g"


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


def signed_package_path(package_path: Path) -> Path:
    return package_path.with_name(f"{package_path.stem}.signed{package_path.suffix}")


def find_signed_package(package_path: Path) -> Path | None:
    expected = signed_package_path(package_path)
    if expected.exists():
        return expected
    packages = sorted(
        package_path.parent.glob("*.signed.difypkg"),
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    return packages[0] if packages else None


def inspect_package_archive(package_path: Path) -> dict[str, Any]:
    inspection: dict[str, Any] = {
        "readable": False,
        "manifest_present": False,
        "requirements_present": False,
        "uv_lock_present": False,
        "wheel_count": 0,
    }
    if not package_path.is_file():
        return inspection

    try:
        with zipfile.ZipFile(package_path) as archive:
            names = archive.namelist()
    except (OSError, zipfile.BadZipFile):
        return inspection

    normalized = [name.lstrip("./") for name in names]
    inspection["readable"] = True
    inspection["manifest_present"] = any(
        name == "manifest.yaml" or name.endswith("/manifest.yaml")
        for name in normalized
    )
    inspection["requirements_present"] = any(
        name == "requirements.txt" or name.endswith("/requirements.txt")
        for name in normalized
    )
    inspection["uv_lock_present"] = any(
        name == "uv.lock" or name.endswith("/uv.lock")
        for name in normalized
    )
    inspection["wheel_count"] = sum(
        1
        for name in normalized
        if name.endswith(".whl") and (name.startswith("wheels/") or "/wheels/" in name)
    )
    return inspection


def log_package_archive_inspection(job: JobRecord, package_path: Path) -> None:
    inspection = inspect_package_archive(package_path)
    if not inspection["readable"]:
        job.log("[inspect] Unable to inspect the generated package archive")
        return

    job.log(
        "[inspect] "
        f"manifest.yaml={'yes' if inspection['manifest_present'] else 'no'}, "
        f"requirements.txt={'yes' if inspection['requirements_present'] else 'no'}, "
        f"uv.lock={'present' if inspection['uv_lock_present'] else 'absent'}, "
        f"bundled wheels={inspection['wheel_count']}"
    )
    if inspection["requirements_present"] and inspection["wheel_count"] == 0:
        job.log("[inspect] Warning: requirements.txt exists but no bundled wheels were found in the output package")
    if inspection["uv_lock_present"]:
        job.log("[inspect] Warning: uv.lock is still present in the output package and may force Dify to resolve dependencies online")


def run_subprocess(
    job: JobRecord,
    command: list[str],
    cwd: Path,
    env: dict[str, str],
    *,
    log_command: str | None = None,
) -> None:
    job.log(log_command or f"[exec] {' '.join(command)}")
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


def resolve_private_key_path(job: JobRecord) -> tuple[Path, str]:
    if job.signature_private_key_path:
        private_key_path = Path(job.signature_private_key_path)
        if not private_key_path.is_file():
            raise RuntimeError(f"未找到已上传的私钥文件：{private_key_path}")
        return private_key_path, "uploaded"

    private_key_path, private_key_source = resolve_server_private_key_path()
    if private_key_path and private_key_path.is_file():
        return private_key_path, private_key_source

    if private_key_source == "env_invalid":
        configured_path = env_path(SIGNING_PRIVATE_KEY_PATH_ENV)
        raise RuntimeError(
            f"配置的私钥路径无效：{configured_path}。"
            f"请检查 {SIGNING_PRIVATE_KEY_PATH_ENV}。"
        )

    if not private_key_path:
        raise RuntimeError(
            "当前任务已要求签名，但没有可用私钥。"
            "请上传私钥、在界面中生成托管密钥对，"
            f"或配置 {SIGNING_PRIVATE_KEY_PATH_ENV}。"
        )
    raise RuntimeError("当前任务已要求签名，但没有可用的私钥。")


def resolve_public_key_path(job: JobRecord) -> tuple[Path | None, str]:
    if job.signature_public_key_path:
        public_key_path = Path(job.signature_public_key_path)
        if not public_key_path.is_file():
            raise RuntimeError(f"未找到已上传的公钥文件：{public_key_path}")
        return public_key_path, "uploaded"

    public_key_path, public_key_source = resolve_server_public_key_path()
    if not public_key_path:
        return None, public_key_source
    if not public_key_path.is_file():
        job.log(
            f"[签名] 跳过验签，因为 {SIGNING_PUBLIC_KEY_PATH_ENV} "
            f"指向的文件不存在：{public_key_path}"
        )
        return None, "invalid"
    return public_key_path, public_key_source


def sign_package(
    job: JobRecord,
    runner_dir: Path,
    package_path: Path,
    env: dict[str, str],
) -> Path:
    cli_path = runner_dir / host_cli_binary_name()
    if not cli_path.is_file():
        raise RuntimeError(f"缺少签名命令行工具：{cli_path.name}")
    signature_cli_status = detect_signature_cli_status()
    if not signature_cli_status["supported"]:
        raise RuntimeError(signature_cli_status["error"] or "当前内置签名命令行工具不支持插件签名。")

    private_key_path, private_key_source = resolve_private_key_path(job)
    public_key_path, public_key_source = resolve_public_key_path(job)

    job.log(
        "[签名] 正在使用"
        f"{private_key_source}私钥进行签名（{describe_key_path(private_key_path)}）"
    )
    run_subprocess(
        job,
        [str(cli_path), "signature", "sign", str(package_path), "-p", str(private_key_path)],
        package_path.parent,
        env,
        log_command=(
            f"[exec] {cli_path.name} signature sign {package_path.name} -p "
            "[private-key]"
        ),
    )

    signed_path = find_signed_package(package_path)
    if not signed_path:
        raise RuntimeError("Signing finished but no .signed.difypkg file was generated")

    job.log(f"[签名] 已生成签名包：{signed_path.name}")

    if not public_key_path:
        job.log("[签名] 跳过验签：没有上传或配置可用公钥")
        return signed_path

    job.log(
        "[签名] 正在使用"
        f"{public_key_source}公钥进行验签（{describe_key_path(public_key_path)}）"
    )
    run_subprocess(
        job,
        [str(cli_path), "signature", "verify", str(signed_path), "-p", str(public_key_path)],
        signed_path.parent,
        env,
        log_command=(
            f"[exec] {cli_path.name} signature verify {signed_path.name} -p "
            "[public-key]"
        ),
    )
    job.log("[签名] 验签成功")
    return signed_path


def cleanup_sensitive_inputs(job: JobRecord) -> None:
    uploaded_paths = [
        job.signature_private_key_path,
        job.signature_public_key_path,
    ]
    for path_str in uploaded_paths:
        if not path_str:
            continue
        path = Path(path_str)
        with contextlib.suppress(FileNotFoundError, PermissionError, OSError):
            path.unlink()
        with contextlib.suppress(OSError):
            path.parent.rmdir()


def run_command_capture(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        check=False,
    )


def ensure_openssl_available() -> None:
    status = detect_openssl_status()
    if not status["available"]:
        raise RuntimeError(status["error"] or "OpenSSL is not available in the current runtime.")


def generate_managed_signing_key_pair(*, overwrite: bool = False) -> dict[str, Any]:
    ensure_openssl_available()
    ensure_directories()

    private_key = managed_private_key_path()
    public_key = managed_public_key_path()
    metadata_path = managed_signing_metadata_path()

    if private_key.exists() and public_key.exists() and not overwrite:
        raise RuntimeError(
            "A managed signing key pair already exists. Download it first if you need a backup, "
            "then regenerate with overwrite enabled."
        )

    workspace = MANAGED_SIGNING_DIR / f"tmp-{uuid.uuid4().hex[:8]}"
    workspace.mkdir(parents=True, exist_ok=True)
    tmp_private_key = workspace / "private.pem"
    tmp_public_key = workspace / "public.pem"

    try:
        private_result = run_command_capture(
            ["openssl", "genrsa", "-traditional", "-out", str(tmp_private_key), "2048"],
            workspace,
        )
        if private_result.returncode != 0:
            raise RuntimeError(private_result.stderr.strip() or private_result.stdout.strip() or "OpenSSL key generation failed.")

        public_result = run_command_capture(
            ["openssl", "rsa", "-in", str(tmp_private_key), "-RSAPublicKey_out", "-out", str(tmp_public_key)],
            workspace,
        )
        if public_result.returncode != 0:
            raise RuntimeError(public_result.stderr.strip() or public_result.stdout.strip() or "OpenSSL public key export failed.")

        shutil.move(str(tmp_private_key), str(private_key))
        shutil.move(str(tmp_public_key), str(public_key))
        write_json_file(
            metadata_path,
            {
                "generated_at": now_iso(),
                "algorithm": "RSA-2048",
                "private_key_format": "PEM PKCS#1 (RSA PRIVATE KEY)",
                "public_key_format": "PEM PKCS#1 (RSA PUBLIC KEY)",
            },
        )
    finally:
        shutil.rmtree(workspace, ignore_errors=True)

    return summarize_managed_signing_key_pair()


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
    log_package_archive_inspection(job, target_path)
    final_artifact = target_path

    if job.sign_output:
        final_artifact = sign_package(job, runner_dir, target_path, env)
        log_package_archive_inspection(job, final_artifact)

    job.set_artifact(final_artifact)
    job.log(f"[done] Output package ready: {final_artifact.name}")


def background_job_runner(job_id: str) -> None:
    job = get_job(job_id)
    try:
        job.transition("running")
        execute_job(job)
        job.transition("succeeded")
    except Exception as exc:  # noqa: BLE001
        job.log(f"[error] {exc}")
        job.transition("failed", str(exc))
    finally:
        cleanup_sensitive_inputs(job)


app = FastAPI(title="Dify Plugin Packager UI")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def static_asset_url(filename: str) -> str:
    path = STATIC_DIR / filename
    version = int(path.stat().st_mtime) if path.exists() else 0
    return f"/static/{filename}?v={version}"


@app.on_event("startup")
def startup() -> None:
    ensure_directories()
    ensure_vendor_files()


@app.get("/", response_class=HTMLResponse)
async def index() -> HTMLResponse:
    template = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    html = (
        template
        .replace("__STYLES_CSS_URL__", static_asset_url("styles.css"))
        .replace("__APP_JS_URL__", static_asset_url("app.js"))
    )
    return HTMLResponse(html)


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
            "signing": get_signing_runtime_config(),
        }
    )


@app.get("/api/signing")
async def signing_config() -> JSONResponse:
    return JSONResponse(get_signing_runtime_config())


@app.post("/api/signing/managed/generate")
async def generate_managed_signing_keys(overwrite: bool = False) -> JSONResponse:
    try:
        state = generate_managed_signing_key_pair(overwrite=overwrite)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    return JSONResponse(
        {
            "message": "托管签名密钥对已生成。",
            "managed_key_pair": state,
            "signing": get_signing_runtime_config(),
        },
        status_code=201,
    )


@app.get("/api/signing/managed/download/{key_kind}")
async def download_managed_signing_key(key_kind: str) -> FileResponse:
    normalized = key_kind.strip().lower()
    if normalized not in {"private", "public"}:
        raise HTTPException(status_code=400, detail="密钥类型必须是 `private` 或 `public`。")

    path = managed_private_key_path() if normalized == "private" else managed_public_key_path()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="未找到托管签名密钥。")

    return FileResponse(path, filename=path.name)


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
        raise HTTPException(status_code=409, detail="任务产物尚未就绪")
    artifact_path = Path(snapshot["artifact_path"])
    if not artifact_path.exists():
        raise HTTPException(status_code=404, detail="未找到产物文件")
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
    sign_output: str | None = Form(default=None),
    signature_private_key: UploadFile | None = File(default=None),
    signature_public_key: UploadFile | None = File(default=None),
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
        raise HTTPException(status_code=400, detail="不支持的来源类型")
    if target_arch not in SUPPORTED_ARCHES:
        raise HTTPException(status_code=400, detail="不支持的目标架构")
    if host_arch == "arm64" and target_arch == "amd64":
        raise HTTPException(
            status_code=400,
            detail="当前运行环境为 arm64，内置脚本不支持生成 amd64 目标产物。",
        )

    job_id = uuid.uuid4().hex[:12]
    job_dir = JOBS_DIR / job_id
    input_dir = job_dir / "input"
    input_dir.mkdir(parents=True, exist_ok=True)

    meta: dict[str, str] = {}
    source_summary = ""
    input_name: str | None = None
    key_dir = job_dir / "keys"
    key_dir.mkdir(parents=True, exist_ok=True)

    if source == "local":
        if not package_file or not package_file.filename:
            raise HTTPException(status_code=400, detail="本地上传模式必须提供插件包文件")
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
            raise HTTPException(status_code=400, detail=f"缺少字段：{', '.join(missing)}")
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
            raise HTTPException(status_code=400, detail=f"缺少字段：{', '.join(missing)}")
        meta = {
            "market_author": market_author.strip(),
            "market_name": market_name.strip(),
            "market_version": market_version.strip(),
        }
        source_summary = (
            f"{meta['market_author']}/{meta['market_name']} @ {meta['market_version']}"
        )

    uploaded_private_key_path: str | None = None
    uploaded_public_key_path: str | None = None

    if signature_private_key and signature_private_key.filename:
        private_key_name = safe_filename(signature_private_key.filename)
        private_key_path = key_dir / private_key_name
        with private_key_path.open("wb") as handle:
            while chunk := await signature_private_key.read(1024 * 1024):
                handle.write(chunk)
        uploaded_private_key_path = str(private_key_path)

    if signature_public_key and signature_public_key.filename:
        public_key_name = safe_filename(signature_public_key.filename)
        public_key_path = key_dir / public_key_name
        with public_key_path.open("wb") as handle:
            while chunk := await signature_public_key.read(1024 * 1024):
                handle.write(chunk)
        uploaded_public_key_path = str(public_key_path)

    server_private_key_path, server_private_key_source = resolve_server_private_key_path()
    server_private_key_ready = bool(server_private_key_path and server_private_key_path.is_file())
    signature_cli_ready = detect_signature_cli_status()["supported"]
    sign_output_requested = parse_form_bool(
        sign_output,
        default=(bool(uploaded_private_key_path) or server_private_key_ready) and signature_cli_ready,
    )

    if sign_output_requested and not uploaded_private_key_path and not server_private_key_ready:
        raise HTTPException(
            status_code=400,
            detail=(
                "当前任务已要求签名，但没有可用私钥。"
                "请上传私钥、在界面中生成托管密钥对，"
                f"或配置 {SIGNING_PRIVATE_KEY_PATH_ENV}。"
            ),
        )
    if sign_output_requested and not signature_cli_ready:
        raise HTTPException(
            status_code=400,
            detail=detect_signature_cli_status()["error"] or "当前内置签名命令行工具不支持插件签名。",
        )

    if sign_output_requested:
        meta["sign_output"] = "true"
        meta["signature_source"] = "uploaded" if uploaded_private_key_path else server_private_key_source
        if uploaded_public_key_path:
            meta["verification_source"] = "uploaded"
        else:
            _, server_public_key_source = resolve_server_public_key_path()
            meta["verification_source"] = server_public_key_source
    else:
        meta["sign_output"] = "false"
        meta["signature_source"] = "none"
        meta["verification_source"] = "none"

    job = JobRecord(
        id=job_id,
        source=source,
        target_arch=target_arch,
        created_at=now_iso(),
        source_summary=source_summary,
        work_dir=str(job_dir),
        input_name=input_name,
        sign_output=sign_output_requested,
        signature_private_key_path=uploaded_private_key_path,
        signature_public_key_path=uploaded_public_key_path,
        meta=meta,
    )
    job.log("[job] Created packaging job")
    if job.sign_output:
        job.log(
            "[job] Output signing enabled. "
            f"Private key source: {job.meta.get('signature_source', 'unknown')}. "
            f"Verification key source: {job.meta.get('verification_source', 'none')}."
        )
    else:
        job.log("[job] Output signing disabled")

    with jobs_lock:
        jobs[job_id] = job

    worker = threading.Thread(target=background_job_runner, args=(job_id,), daemon=True)
    worker.start()

    return JSONResponse(job.snapshot(), status_code=201)
