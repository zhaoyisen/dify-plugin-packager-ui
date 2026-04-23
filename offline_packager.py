from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

DEFAULT_DAEMON_VERSION = "0.5.8"


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


def cached_cli_asset_name(host_os: str, host_arch: str, daemon_version: str) -> str:
    os_name = "windows" if host_os == "windows" else "darwin" if host_os == "darwin" else "linux"
    suffix = ".exe" if os_name == "windows" else ""
    arch = "arm64" if host_arch == "arm64" else "amd64"
    return f"dify-plugin-cli-{daemon_version}-{os_name}-{arch}{suffix}"


@dataclass(frozen=True)
class RuntimeConfig:
    work_dir: Path
    cache_dir: Path
    output_dir: Path
    vendor_dir: Path
    legacy_vendor_dir: Path
    host_os: str
    host_arch: str
    target_arch: str
    pip_index_url: str
    github_api_url: str
    marketplace_api_url: str
    daemon_version: str
    cli_path: Path | None = None


class OfflinePackager:
    def __init__(self, config: RuntimeConfig, log: Callable[[str], None]) -> None:
        self.config = config
        self.log = log

    def package_from_local_file(self, source_path: Path) -> Path:
        source = Path(source_path).resolve()
        if not source.is_file():
            raise RuntimeError(f"Source package does not exist: {source}")
        return self._run_packager(["--local", str(source)])

    def package_from_github_release(self, repo: str, release: str, asset_name: str) -> Path:
        repo = repo.strip()
        release = release.strip()
        asset_name = asset_name.strip()
        if not repo or not release or not asset_name:
            raise RuntimeError("GitHub packaging requires repo, release, and asset name.")
        return self._run_packager(["--github", f"{repo}:{release}:{asset_name}"])

    def package_from_marketplace(self, author: str, plugin_name: str, version: str) -> Path:
        author = author.strip()
        plugin_name = plugin_name.strip()
        version = version.strip()
        if not author or not plugin_name or not version:
            raise RuntimeError("Marketplace packaging requires author, plugin name, and version.")
        return self._run_packager(["--marketplace", f"{author}/{plugin_name}:{version}"])

    def _run_packager(self, args: list[str]) -> Path:
        if self.config.target_arch != self.config.host_arch:
            raise RuntimeError(
                "The vendored offline packager only supports packaging for the current host architecture. "
                f"Host={self.config.host_arch}, target={self.config.target_arch}."
            )

        script_path = self.config.vendor_dir / "scripts" / "packager.py"
        if not script_path.is_file():
            raise RuntimeError(f"Vendored packager script is missing: {script_path}")

        cli_source = self._resolve_cli_source()
        runtime_root = self.config.work_dir / "packager-runtime"
        runtime_bin_dir = runtime_root / "bin"
        if runtime_root.exists():
            shutil.rmtree(runtime_root, ignore_errors=True)
        runtime_bin_dir.mkdir(parents=True, exist_ok=True)

        cli_runtime_path = runtime_bin_dir / cli_source.name
        shutil.copy2(cli_source, cli_runtime_path)
        cli_runtime_path.chmod(cli_runtime_path.stat().st_mode | stat.S_IEXEC)

        self.config.output_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["OUTPUT_DIR"] = str(self.config.output_dir)
        env["BIN_DIR"] = str(runtime_bin_dir)
        env["PIP_INDEX_URL"] = self.config.pip_index_url
        env["GITHUB_API_URL"] = self.config.github_api_url
        env["MARKETPLACE_API_URL"] = self.config.marketplace_api_url
        env["DIFY_PLUGIN_DAEMON_VERSION"] = self.config.daemon_version
        env["DIFY_PLUGIN_CLI_PATH"] = str(cli_runtime_path)

        command = [sys.executable, str(script_path), *args]
        self.log(f"[packager] Using vendored script: {script_path}")
        self.log(f"[packager] Using local CLI: {cli_source}")
        self.log(f"[packager] Output directory: {self.config.output_dir}")
        self._stream_command(command, cwd=runtime_root, env=env)

        package = self._find_output_package()
        if not package:
            raise RuntimeError("The vendored packager completed without producing an offline package.")
        return package

    def _resolve_cli_source(self) -> Path:
        candidates: list[Path] = []
        explicit = self.config.cli_path.expanduser().resolve() if self.config.cli_path else None
        if explicit:
            candidates.append(explicit)

        asset_name = host_cli_asset_name(self.config.host_arch)
        cached_name = cached_cli_asset_name(
            self.config.host_os,
            self.config.host_arch,
            self.config.daemon_version,
        )
        candidates.extend(
            [
                self.config.cache_dir / "cli" / self.config.daemon_version / asset_name,
                self.config.cache_dir / "cli" / self.config.daemon_version / cached_name,
                self.config.vendor_dir / "bin" / asset_name,
                self.config.vendor_dir / "bin" / cached_name,
                self.config.legacy_vendor_dir / asset_name,
            ]
        )

        legacy_name = "dify-plugin-linux-arm64-5g" if self.config.host_arch == "arm64" else "dify-plugin-linux-amd64-5g"
        candidates.append(self.config.legacy_vendor_dir / legacy_name)

        for candidate in candidates:
            if candidate.is_file():
                return candidate

        locations = [
            str(self.config.vendor_dir / "bin" / asset_name),
            str(self.config.cache_dir / "cli" / self.config.daemon_version / asset_name),
        ]
        raise RuntimeError(
            "Missing local dify-plugin CLI. Place the binary in "
            f"{locations[0]} or set DIFY_PLUGIN_CLI_PATH."
        )

    def _stream_command(self, command: list[str], *, cwd: Path, env: dict[str, str]) -> None:
        self.log(f"[exec] {' '.join(command)}")
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
            raise RuntimeError(f"Vendored offline packager failed with exit code {code}")

    def _find_output_package(self) -> Path | None:
        packages = sorted(
            self.config.output_dir.glob("*-offline.difypkg"),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        return packages[0] if packages else None
