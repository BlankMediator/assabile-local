# Assabile Local Controls

## Launchers

- `start_server.bat`: start only the server.
- `start_cli.bat`: open the interactive CLI; starts the server if needed.
- `start_webui.bat`: open the web UI; starts the server if needed.
- `update_catalog.bat`: refresh catalogue metadata.

Build install ZIPs:

```powershell
python scripts\build_installs.py --clean
```

The generated bundles are documented in `docs/INSTALLS.md`.

Direct commands:

```powershell
python server.py
python assabile_cli.py shell
python assabile_cli.py gui
python assabile_cli.py serve --host 127.0.0.1 --port 9000
```

When the server terminal shows `assabile>`, use:

- `gui`: open the web UI.
- `cli`: open the interactive CLI.
- `help`: list prompt commands.
- `stop`: shut down that server.

## Home

- Home button: returns to the catalogue. On the home page it can be used as a reload-style home action.
- Docs button: opens this controls page in the app.
- Category tabs: All, Quran, Anasheed, Lessons, Photos, Videos.
- Search: filters profiles and matching tracks using app-local search memory.
- Quran filters: revelation, riwaya, and surah. Surahs are ordered from Al-Fatiha to An-Nas.
- Country filter: limits profiles and track results by country.
- Content filter: show only profiles with recitations, anasheed, audio lessons, video lessons, photos, or videos.
- Sort: alphabetical or by largest content count.
- Profile checkboxes: select multiple profiles for ZIP downloads.
- Download selected ZIP: downloads selected profiles by media kind.
- Search result tracks: play, add, download, open source, or go to the profile.

## Profile

- Profile ZIP selector: download all files or one media kind for the current profile.
- Tabs include counts for recitations, anasheed, audio lessons, video lessons, photos, and videos.
- Bio appears above the profile tabs when available.
- Same Country: use the arrow button on a tile to jump to another profile.
- Comments: read-only mirrored comments where available.
- Source/open buttons use the external-arrow symbol.
- Download buttons use the download symbol.
- The quick-search sidebar appears on profile pages; its home button appears only after the profile header has scrolled away.

## Al-Massahef And Recitations

- Empty collections are greyed out.
- Collection tiles open the relevant collection playlist.
- Recitation sorting supports traditional order, surah name, chronological order, verse count, and most listened.
- Recitation filters include all/makki/madani and collection/riwaya where metadata is available.
- Recitation playback loads the relevant queue and highlights the current track wherever it appears.

## Albums, Lessons, Photos, And Videos

- Anasheed, audio lesson, and video lesson albums are scrollable beneath their titles.
- Album play loads that album into the queue.
- Add actions can add a track, add the whole album, or replace the queue with that album depending on the selected behavior.
- Album and section downloads can be saved as ZIP files.
- Photos open/download the correct full-size image on demand.
- Videos and video lessons use thumbnails where available and play in the universal player.

## Player

- Play/Pause: toggles playback.
- Previous/Next: moves through the queue.
- -10/+10: skips ten seconds.
- Seek bar: drag to seek. The played portion is highlighted.
- Left time label: elapsed time only.
- Right time label: remaining time.
- Trim: opens exact start/end entry. The strip handles can also be dragged like column/cell resize handles.
- Trim ranges are temporary and reset when another track plays or the player closes.
- Volume: persists across tracks and can be set by slider or typed percentage.
- Speed: changes playback speed for audio and video.
- Fullsize video: expands video while keeping custom controls at the bottom; exiting restores the previous player size.
- Resize: drag the top-left or bottom-right grip, or use the sticky header resize button when the player body is scrolled.
- Collapse: collapses the player regardless of resized size, then restores the saved size when expanded.
- Shuffle: changes next/previous queue navigation.
- Repeat: cycles off/1/2/3 repeats of the current file.
- Autoplay: controls whether the next queue item starts after the current item ends.
- Queue: expands/collapses with the arrow and scrolls to the now-playing item.
- Queue count: shown in the queue header.
- Lock: protects the queue from accidental drag reordering, clearing, or row deletion.
- Drag handle: reorder queue rows.
- X on a queue row: remove that track from the queue.
- Clear: removes all queued items except the current item.
- Player X: asks for confirmation, then stops playback and clears the full queue including the current track.

## CLI

```powershell
python assabile_cli.py serve
python assabile_cli.py shell
python assabile_cli.py gui
python assabile_cli.py sync
python assabile_cli.py list mishary
python assabile_cli.py search sudais --surah Al-Fatiha
python assabile_cli.py search hafs --kind recitation --riwaya hafs --page 2 --per-page 50
python assabile_cli.py profile abdul-rahman-al-sudais-12
python assabile_cli.py profile abdul-rahman-al-sudais-12 --json
python assabile_cli.py tracks ayman-swed-345 --kind videoLesson --page 2 --per-page 5
python assabile_cli.py tracks abdallah-kamel-318 --kind recitation --collection 177 --page 1 --per-page 25
python assabile_cli.py tracks abdallah-kamel-318 --riwaya hafs --surah Fatiha
python assabile_cli.py play ayman-swed-345 --index 1
python assabile_cli.py play ayman-swed-345 "Episode 10" --first
python assabile_cli.py download --person abdallah-kamel-318 --kind recitations
python assabile_cli.py library
python assabile_cli.py cache info
python assabile_cli.py cache clear
python assabile_cli.py servers list
python assabile_cli.py servers stop --pid 12345
python assabile_cli.py servers stop --all
```

CLI profile and playback flow:

- `search <term> --people`: find a profile id.
- `profile <profile-id>`: show counts; add `--json` for full metadata.
- `tracks <profile-id>`: list playable recitations, tracks, and videos with stable indexes.
- `tracks <profile-id> --page 2 --per-page 80`: page through long track lists.
- `play <profile-id> --index <n>`: cache and open that item locally.
- `play <profile-id> <title words> --first`: play the first matching title.

Filter flags for `search`, `tracks`, and `play`:

- `--kind`: `recitation`, `anasheed`, `audioLesson`, `videoLesson`, or `video`.
- `--collection`: collection id or title.
- `--riwaya` / `--riwayah`
- `--surah`
- `--album`
- `--revelation`
- `--country`: available on `search`.
- `--page` and `--per-page`: available on `search` and `tracks`.

## Sync And Cache

- Metadata sync downloads pages, JSON, and XML metadata only.
- Media files are cached only when played or downloaded.
- `data/downloads/` is the permanent shared cache used by both CLI and WebUI playback.
- Existing downloaded files are reused while present.
- Bulk downloads and playback share the same source-URL cache, so recitations downloaded through a profile/reciter ZIP can be reused later by CLI/WebUI playback.
- If catalogue sync discovers that a local media item now points to a different Assabile source URL, the next play/download refreshes that cached file.
- If a cached file is removed, the next play/download fetches it again.
- `python assabile_cli.py cache clear` asks for confirmation and removes all files under `data/downloads/`.
- `python assabile_cli.py cache clear --yes` skips confirmation for scripted cleanup.
- Sync merges language fallback sources from `www`, `ar`, `fr`, and `es` Assabile pages where available.
- Video lesson series are retried through fallback language/source pages before being left empty.
- Cached metadata is stored under `data/cache/`.
- Cached media and ZIPs are stored under `data/downloads/`.

## Server Management

```powershell
python assabile_cli.py servers list
python assabile_cli.py servers stop --all
python assabile_cli.py servers stop --all-other
python assabile_cli.py serve --host 127.0.0.1 --port 9000
```
