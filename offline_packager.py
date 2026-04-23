from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tomllib
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.parse import quote
from urllib.request import urlopen

import tomli_w

DEFAULT_DAEMON_VERSION = "0.5.8"
DEFAULT_CLI_DOWNLOAD_BASE_URL = "https://github.com/langgenius/dify-plugin-daemon/releases/download"
TRUE_VALUES = {"1", "true", "yes", "on"}


def normalize_arch(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"amd64", "x86_64"}:
        return "amd64"
    if raw in {"arm64", "aarch64"}:
        return "arm64"
    return raw or "unknown"


def host_cli_asset_name(host_arch: str) -> str:
    if host_arch == "arm64":
        return "dify-plugin-linux-arm64"
    return "dify-plugin-linux-amd64"


def target_machine_name(target_arch: str) -> str:
    if target_arch == "arm64":
        return "aarch64"
    return "x86_64"


def safe_filename(name: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "._-" else "-" for ch in name).strip(".-")
    return cleaned or "plugin.difypkg"


@dataclass(frozen=True)
class RuntimeConfig:
    work_dir: Path
    cache_dir: Path
    output_dir: Path
    host_os: str
    host_arch: str
    target_arch: str
    pip_index_url: str
    github_api_url: str
    marketplace_api_url: str
    daemon_version: str
    cli_download_base_url: str


class OfflinePackager:
    def __init__(self, config: RuntimeConfig, log: Callable[[str], None]) -> None:
        self.config = config
        self.log = log
        self.python_version = f"{sys.version_info.major}.{sys.version_info.minor}"

    def package_from_local_file(self, source_path: Path) -> Path:
        source_path = source_path.resolve()
        if not source_path.is_file():
            raise RuntimeError(f"Source package does not exist: {source_path}")

        workspace = self.config.work_dir / "packager"
        if workspace.exists():
            shutil.rmtree(workspace, ignore_errors=True)
        workspace.mkdir(parents=True, exist_ok=True)

        package_copy = workspace / source_path.name
        shutil.copy2(source_path, package_copy)
        plugin_dir = workspace / "plugin"
        plugin_dir.mkdir(parents=True, exist_ok=True)
        self._unpack_plugin(package_copy, plugin_dir)

        plugin_root = self._resolve_plugin_root(plugin_dir)
        self.log(f"[packager] Plugin root: {plugin_root}")

        if (plugin_root / "pyproject.toml").is_file():
            self.log("[packager] Detected pyproject.toml plugin")
            self._prepare_pyproject_plugin(plugin_root)
        elif (plugin_root / "requirements.txt").is_file():
            self.log("[packager] Detected requirements.txt plugin")
            self._prepare_requirements_plugin(plugin_root)
        else:
            self.log("[packager] No Python dependency manifest found, packaging as-is")
            self._sanitize_difyignore(plugin_root)

        cli_path = self._ensure_cli_binary()
        output_path = self.config.output_dir / f"{package_copy.stem}-offline.difypkg"
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if output_path.exists():
            output_path.unlink()

        self._run_command(
            [str(cli_path), "plugin", "package", str(plugin_root), "-o", str(output_path)],
            cwd=workspace,
            env=self._command_env(),
            log_command=f"[exec] {cli_path.name} plugin package {plugin_root.name} -o {output_path.name}",
        )
        return output_path

    def download_github_release(self, repo: str, release: str, asset_name: str, destination: Path) -> Path:
        repo = repo.strip()
        release = release.strip()
        asset_name = asset_name.strip()
        if not repo or not release or not asset_name:
            raise RuntimeError("GitHub packaging requires repo, release, and asset name.")

        base_repo = repo
        if not base_repo.startswith(("http://", "https://")):
            base_repo = f"{self.config.github_api_url.rstrip('/')}/{repo}"
        url = f"{base_repo.rstrip('/')}/releases/download/{quote(release)}/{quote(asset_name)}"
        destination.mkdir(parents=True, exist_ok=True)
        output_path = destination / safe_filename(asset_name)
        self.log(f"[github] Downloading {url}")
        with urlopen(url, timeout=120) as response, output_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        self.log(f"[github] Saved package to {output_path.name}")
        return output_path

    def download_market_package(
        self,
        *,
        author: str,
        plugin_name: str,
        version: str,
        destination: Path,
    ) -> Path:
        author = author.strip()
        plugin_name = plugin_name.strip()
        version = version.strip()
        if not author or not plugin_name or not version:
            raise RuntimeError("Marketplace packaging requires author, plugin name, and version.")

        base = self.config.marketplace_api_url.rstrip("/")
        url = (
            f"{base}/api/v1/plugins/"
            f"{quote(author)}/{quote(plugin_name)}/{quote(version)}/download"
        )
        destination.mkdir(parents=True, exist_ok=True)
        output_path = destination / f"{safe_filename(author)}-{safe_filename(plugin_name)}_{safe_filename(version)}.difypkg"
        self.log(f"[market] Downloading {url}")
        with urlopen(url, timeout=120) as response, output_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        self.log(f"[market] Saved package to {output_path.name}")
        return output_path

    def _prepare_requirements_plugin(self, plugin_root: Path) -> None:
        requirements_path = plugin_root / "requirements.txt"
        wheels_dir = plugin_root / "wheels"
        wheels_dir.mkdir(parents=True, exist_ok=True)

        self._sanitize_plugin_tree(plugin_root, keep_pyproject=False)
        self._download_wheels(requirements_path, wheels_dir)
        self._prepend_offline_requirements_header(requirements_path)

    def _prepare_pyproject_plugin(self, plugin_root: Path) -> None:
        pyproject_path = plugin_root / "pyproject.toml"
        wheels_dir = plugin_root / "wheels"
        requirements_path = plugin_root / "requirements.txt"
        wheels_dir.mkdir(parents=True, exist_ok=True)

        pyproject = self._load_toml(pyproject_path)
        self._prepare_pyproject_metadata(pyproject)
        self._write_toml(pyproject_path, pyproject)

        env = self._command_env()
        self._run_command(
            ["uv", "lock", "--no-python-downloads"],
            cwd=plugin_root,
            env=env,
            log_command="[exec] uv lock --no-python-downloads",
        )
        self._run_command(
            [
                "uv",
                "export",
                "--format",
                "requirements.txt",
                "--output-file",
                str(requirements_path),
                "--frozen",
                "--no-default-groups",
                "--no-dev",
                "--no-editable",
                "--no-emit-project",
                "--no-hashes",
            ],
            cwd=plugin_root,
            env=env,
            log_command=(
                "[exec] uv export --format requirements.txt --output-file requirements.txt "
                "--frozen --no-default-groups --no-dev --no-editable --no-emit-project --no-hashes"
            ),
        )

        self._download_wheels(requirements_path, wheels_dir)
        self._prepend_offline_requirements_header(requirements_path)

        pyproject = self._load_toml(pyproject_path)
        tool_uv = pyproject.setdefault("tool", {}).setdefault("uv", {})
        tool_uv["no-index"] = True
        tool_uv["find-links"] = ["./wheels/"]
        self._write_toml(pyproject_path, pyproject)

        self._sanitize_plugin_tree(plugin_root, keep_pyproject=True)

    def _prepare_pyproject_metadata(self, pyproject: dict) -> None:
        pyproject.pop("dependency-groups", None)

        tool = pyproject.setdefault("tool", {})
        tool_uv = tool.setdefault("uv", {})
        tool_uv.pop("default-groups", None)
        tool_uv.pop("dev-dependencies", None)
        tool_uv["environments"] = [self._uv_environment_marker()]

    def _download_wheels(self, requirements_path: Path, wheels_dir: Path) -> None:
        command = [
            sys.executable,
            "-m",
            "pip",
            "download",
            "-r",
            str(requirements_path),
            "-d",
            str(wheels_dir),
            "--index-url",
            self.config.pip_index_url,
        ]
        if self.config.target_arch != self.config.host_arch:
            command.extend(["--platform", self._pip_platform_name(), "--only-binary", ":all:"])

        self._run_command(
            command,
            cwd=requirements_path.parent,
            env=self._command_env(),
            log_command=f"[exec] python -m pip download -r {requirements_path.name} -d {wheels_dir.name}",
        )

    def _sanitize_plugin_tree(self, plugin_root: Path, *, keep_pyproject: bool) -> None:
        uv_lock_path = plugin_root / "uv.lock"
        if uv_lock_path.exists():
            uv_lock_path.unlink()
            self.log("[packager] Removed uv.lock from packaged plugin")

        if not keep_pyproject:
            pyproject_path = plugin_root / "pyproject.toml"
            if pyproject_path.exists():
                pyproject_path.unlink()
                self.log("[packager] Removed pyproject.toml from packaged plugin")

        self._sanitize_difyignore(plugin_root, keep_pyproject=keep_pyproject)

    def _sanitize_difyignore(self, plugin_root: Path, *, keep_pyproject: bool = True) -> None:
        path = plugin_root / ".difyignore"
        if not path.is_file():
            return

        blocked = {
            "wheels/",
            "wheels",
            "wheels/**",
            "*.whl",
            "uv.lock",
        }
        if keep_pyproject:
            blocked.discard("pyproject.toml")
        else:
            blocked.add("pyproject.toml")

        lines = path.read_text(encoding="utf-8").splitlines()
        filtered = [line for line in lines if line.strip() not in blocked]
        path.write_text("\n".join(filtered) + ("\n" if filtered else ""), encoding="utf-8")

    def _prepend_offline_requirements_header(self, requirements_path: Path) -> None:
        header = "--no-index --find-links=./wheels/"
        if not requirements_path.is_file():
            return

        content = requirements_path.read_text(encoding="utf-8")
        lines = content.splitlines()
        if lines and lines[0].strip() == header:
            return
        requirements_path.write_text(f"{header}\n{content}", encoding="utf-8")

    def _ensure_cli_binary(self) -> Path:
        if self.config.host_os != "linux":
            raise RuntimeError("Packaging requires Linux because the official Dify CLI releases are Linux binaries.")

        asset_name = host_cli_asset_name(self.config.host_arch)
        cli_dir = self.config.cache_dir / "cli" / self.config.daemon_version
        cli_dir.mkdir(parents=True, exist_ok=True)
        cli_path = cli_dir / asset_name
        if cli_path.is_file():
            cli_path.chmod(cli_path.stat().st_mode | 0o755)
            return cli_path

        release_base = self.config.cli_download_base_url.rstrip("/")
        url = f"{release_base}/{quote(self.config.daemon_version)}/{asset_name}"
        self.log(f"[cli] Downloading {url}")
        with urlopen(url, timeout=120) as response, cli_path.open("wb") as handle:
            shutil.copyfileobj(response, handle)
        cli_path.chmod(cli_path.stat().st_mode | 0o755)
        self.log(f"[cli] Cached CLI binary: {cli_path.name}")
        return cli_path

    def _uv_environment_marker(self) -> str:
        return (
            f"sys_platform == '{self.config.host_os}' and "
            f"platform_machine == '{target_machine_name(self.config.target_arch)}' and "
            f"python_version == '{self.python_version}'"
        )

    def _pip_platform_name(self) -> str:
        if self.config.target_arch == "arm64":
            return "manylinux2014_aarch64"
        return "manylinux2014_x86_64"

    def _command_env(self) -> dict[str, str]:
        env = os.environ.copy()
        env["PIP_INDEX_URL"] = self.config.pip_index_url
        env["UV_DEFAULT_INDEX"] = self.config.pip_index_url
        env["UV_INDEX_URL"] = self.config.pip_index_url
        return env

    def _run_command(
        self,
        command: list[str],
        *,
        cwd: Path,
        env: dict[str, str],
        log_command: str,
    ) -> None:
        self.log(log_command)
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
            self.log(line.rstrip())
        code = process.wait()
        if code != 0:
            raise RuntimeError(f"Command failed with exit code {code}: {' '.join(command)}")

    def _unpack_plugin(self, package_path: Path, destination: Path) -> None:
        self.log(f"[packager] Unpacking {package_path.name}")
        with zipfile.ZipFile(package_path) as archive:
            archive.extractall(destination)

    def _resolve_plugin_root(self, unpack_root: Path) -> Path:
        if (unpack_root / "manifest.yaml").is_file():
            return unpack_root

        candidates = [
            item for item in unpack_root.iterdir()
            if item.is_dir() and (item / "manifest.yaml").is_file()
        ]
        if len(candidates) == 1:
            return candidates[0]
        raise RuntimeError("Unable to locate manifest.yaml in the unpacked plugin package.")

    def _load_toml(self, path: Path) -> dict:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
        if not isinstance(data, dict):
            raise RuntimeError(f"Invalid TOML document: {path}")
        return data

    def _write_toml(self, path: Path, payload: dict) -> None:
        with path.open("wb") as handle:
            handle.write(tomli_w.dumps(payload).encode("utf-8"))
