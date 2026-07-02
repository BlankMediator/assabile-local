# Install Bundles

Assabile Local can be packaged as three separate ZIP installs. Build them from the repo root with:

```powershell
python scripts\build_installs.py --clean
```

The generated ZIPs are written to `dist/`.

## CLI Bundle

File: `dist/assabile-local-cli.zip`

Use this when you only want command-line browsing, filtering, playback caching, downloads, and catalogue refresh.

Includes:

- `assabile_cli.py`
- `server.py` as the shared local catalogue/download engine used by the CLI
- `data/catalog.json`
- `scripts/sync_catalog.py`
- `start_cli.bat`
- `update_catalog.bat`
- docs and license

Run:

```powershell
start_cli.bat
```

Or:

```powershell
python assabile_cli.py list mishary
python assabile_cli.py search ayman --people
python assabile_cli.py search sudais hafs --people
python assabile_cli.py search idriss fatiha hafs
python assabile_cli.py profile 38
python assabile_cli.py tracks ayman-swed-345 --kind videoLesson --page 2 --per-page 5
python assabile_cli.py tracks 38 fatiha hafs
python assabile_cli.py play ayman-swed-345 --index 1
```

## WebUI Bundle

File: `dist/assabile-local-webui.zip`

Use this when you want the browser UI and local server without the CLI entrypoint.

Includes:

- `server.py`
- `public/`
- `data/catalog.json`
- `scripts/sync_catalog.py`
- `start_server.bat`
- `start_webui.bat`
- `update_catalog.bat`
- docs and license

Run:

```powershell
start_webui.bat
```

Or:

```powershell
python server.py --host 0.0.0.0 --port 8765
```

Then open `http://127.0.0.1:8765` on the same machine, or the printed `http://192.168.x.x:8765` style URL from another device on the same LAN.

## Full Bundle

File: `dist/assabile-local-full.zip`

Use this when you want everything: web UI, server, CLI, sync tools, docs, and launchers.

Includes all source files needed for normal local use, excluding generated cache/download folders.

Run:

```powershell
start_webui.bat
start_cli.bat
```

## What Is Not Bundled

The install ZIPs do not include:

- `data/cache/`
- `data/downloads/`
- `dist/`
- `.git/`
- local development folders
- Python bytecode caches

This keeps installs portable and avoids shipping previously cached media.

## Permanent Media Cache

Each install uses `data/downloads/` as its durable media cache. The server records the source URL for cached files in `data/downloads/_media_cache.json`.

- Replaying or redownloading the same source reuses the existing file.
- Bulk downloads and playback share the same cache by source URL.
- If catalogue sync later points the item at a different Assabile source URL, the next play/download replaces the cached file.
- If you manually remove a cached file, the next play/download recreates it.
- Use `python assabile_cli.py cache clear` to remove the cache after confirmation.

## Refreshing Installs

After code or catalogue changes, rebuild:

```powershell
python scripts\build_installs.py --clean
```

To build one bundle:

```powershell
python scripts\build_installs.py cli
python scripts\build_installs.py webui
python scripts\build_installs.py full
```
