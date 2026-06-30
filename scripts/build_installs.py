from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"

COMMON = [
    "LICENSE",
    "README.md",
    "docs/CONTROLS.md",
    "docs/INSTALLS.md",
    "data/catalog.json",
]

BUNDLES = {
    "cli": {
        "name": "assabile-local-cli",
        "description": "CLI-only workflow with catalogue browsing, filtering, playback caching, downloads, and sync.",
        "paths": [
            *COMMON,
            "assabile_cli.py",
            "server.py",
            "scripts/sync_catalog.py",
            "start_cli.bat",
            "update_catalog.bat",
        ],
    },
    "webui": {
        "name": "assabile-local-webui",
        "description": "Web UI and local server without the CLI entrypoint.",
        "paths": [
            *COMMON,
            "server.py",
            "public",
            "scripts/sync_catalog.py",
            "start_server.bat",
            "start_webui.bat",
            "update_catalog.bat",
        ],
    },
    "full": {
        "name": "assabile-local-full",
        "description": "Complete local web UI, server, CLI, sync tools, docs, and catalogue metadata.",
        "paths": [
            *COMMON,
            "assabile_cli.py",
            "server.py",
            "public",
            "scripts",
            "start_server.bat",
            "start_cli.bat",
            "start_webui.bat",
            "update_catalog.bat",
        ],
    },
}

EXCLUDED_PARTS = {
    ".git",
    "__pycache__",
    "dist",
}

EXCLUDED_PREFIXES = {
    "data/cache",
    "data/downloads",
}


def should_include(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    relative_parts = path.relative_to(ROOT).parts
    parts = set(relative_parts)
    if parts & EXCLUDED_PARTS:
        return False
    if any(part.startswith(".") and part != ".gitignore" for part in relative_parts):
        return False
    return not any(relative == prefix or relative.startswith(prefix + "/") for prefix in EXCLUDED_PREFIXES)


def expand_path(path: str) -> list[Path]:
    source = ROOT / path
    if not source.exists():
        raise FileNotFoundError(path)
    if source.is_file():
        return [source]
    return [item for item in source.rglob("*") if item.is_file() and should_include(item)]


def write_bundle(bundle_id: str) -> Path:
    bundle = BUNDLES[bundle_id]
    DIST.mkdir(exist_ok=True)
    zip_path = DIST / f"{bundle['name']}.zip"
    if zip_path.exists():
        zip_path.unlink()
    seen: set[str] = set()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for entry in bundle["paths"]:
            for path in expand_path(entry):
                if not should_include(path):
                    continue
                arcname = path.relative_to(ROOT).as_posix()
                if arcname in seen:
                    continue
                seen.add(arcname)
                archive.write(path, arcname)
        archive.writestr(
            "INSTALL.txt",
            "\n".join(
                [
                    bundle["description"],
                    "",
                    "Unzip this archive into a folder with write access.",
                    "Run the included .bat launcher or use the Python commands in README.md.",
                    "Media files are cached only when played or downloaded.",
                    "",
                ]
            ),
        )
    return zip_path


def clean_dist() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Assabile Local install ZIP bundles.")
    parser.add_argument("bundle", nargs="*", help="Bundle(s) to build: cli, webui, full. Defaults to all.")
    parser.add_argument("--clean", action="store_true", help="Delete dist/ before building.")
    args = parser.parse_args()
    if args.clean:
        clean_dist()
    targets = args.bundle or sorted(BUNDLES)
    unknown = [target for target in targets if target not in BUNDLES]
    if unknown:
        parser.error(f"unknown bundle(s): {', '.join(unknown)}")
    for bundle_id in targets:
        path = write_bundle(bundle_id)
        print(f"{bundle_id}\t{path.relative_to(ROOT)}\t{path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
