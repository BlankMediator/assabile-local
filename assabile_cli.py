from __future__ import annotations

import argparse
import json
import subprocess
import sys
import os
import shlex
import shutil
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import server


DEFAULT_PORT = 8765

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")


def iter_tracks(person: dict) -> list[dict]:
    rows: list[dict] = []
    collections = {str(collection.get("id", "")): collection for collection in person.get("collections", [])}
    for index, recitation in enumerate(person.get("recitations", []), start=1):
        collection_id = str(recitation.get("collectionId", ""))
        collection = collections.get(collection_id, {})
        rows.append(
            {
                "kind": "recitation",
                "index": index,
                "personId": person["id"],
                "personName": person["name"],
                "title": recitation.get("surah", ""),
                "riwayah": recitation.get("riwayah", ""),
                "surah": recitation.get("surah", ""),
                "revelation": recitation.get("revelation", ""),
                "collectionId": collection_id,
                "collection": collection.get("title", ""),
                "playerXml": recitation.get("playerXml", ""),
            }
        )
    for key, kind in (("albums", "anasheed"), ("audioLessons", "audioLesson"), ("videoLessons", "videoLesson")):
        for collection in person.get(key, []):
            for recording in collection.get("recordings", []):
                rows.append(
                    {
                        "kind": kind,
                        "index": len(rows) + 1,
                        "personId": person["id"],
                        "personName": person["name"],
                        "title": recording.get("title", ""),
                        "album": collection.get("title", ""),
                        "collection": collection.get("title", ""),
                        "mediaUrl": recording.get("mediaUrl", ""),
                        "poster": recording.get("thumb", ""),
                    }
                )
    for video in person.get("videos", []):
        rows.append({"kind": "video", "index": len(rows) + 1, "personId": person["id"], "personName": person["name"], "title": video.get("title", ""), "mediaUrl": video.get("mediaUrl", ""), "poster": video.get("thumb", "")})
    return rows


def text_match(value: str, needle: str) -> bool:
    return needle.lower() in str(value or "").lower()


def filter_tracks(rows: list[dict], args: argparse.Namespace, include_query: bool = True) -> list[dict]:
    query = str(getattr(args, "query", "") or "").lower()
    filtered = []
    for row in rows:
        if getattr(args, "kind", "all") != "all" and row.get("kind") != args.kind:
            continue
        if getattr(args, "surah", "") and not text_match(row.get("surah") or row.get("title"), args.surah):
            continue
        if getattr(args, "riwaya", "") and not text_match(row.get("riwayah"), args.riwaya):
            continue
        if getattr(args, "riwayah", "") and not text_match(row.get("riwayah"), args.riwayah):
            continue
        if getattr(args, "collection", ""):
            collection_haystack = " ".join(str(row.get(key, "")) for key in ("collection", "collectionId", "album"))
            if not text_match(collection_haystack, args.collection):
                continue
        if getattr(args, "album", "") and not text_match(row.get("album") or row.get("collection"), args.album):
            continue
        if getattr(args, "revelation", "") and not text_match(row.get("revelation"), args.revelation):
            continue
        if include_query and query:
            haystack = " ".join(str(row.get(key, "")) for key in ("title", "album", "collection", "personName", "riwayah", "revelation", "kind"))
            if query not in haystack.lower():
                continue
        filtered.append(row)
    return filtered


def page_rows(rows: list[dict], page: int, per_page: int) -> tuple[list[dict], int, int]:
    per_page = max(1, per_page)
    total_pages = max(1, (len(rows) + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    start = (page - 1) * per_page
    return rows[start : start + per_page], page, total_pages


def add_track_filter_args(parser: argparse.ArgumentParser, include_person_filters: bool = False) -> None:
    parser.add_argument("--kind", default="all", choices=["all", "recitation", "anasheed", "audioLesson", "videoLesson", "video"])
    parser.add_argument("--surah", default="", help="Filter by surah title/name")
    parser.add_argument("--riwaya", "--riwayah", dest="riwaya", default="", help="Filter by riwaya/riwayah")
    parser.add_argument("--collection", default="", help="Filter by collection id or title")
    parser.add_argument("--album", default="", help="Filter by album/series title")
    parser.add_argument("--revelation", default="", help="Filter by makiya/madaniya where available")
    if include_person_filters:
        parser.add_argument("--country", default="", help="Filter profile country")


def load_people() -> list[dict]:
    return server.load_catalog().get("people", [])


def cmd_serve(args: argparse.Namespace) -> None:
    server.main(args.host, args.port)


def server_sessions(port: int | None = None) -> list[dict[str, str]]:
    if os.name != "nt" or not shutil.which("netstat"):
        return []
    command = ["netstat", "-ano"]
    try:
        output = subprocess.check_output(command, text=True, errors="ignore", stderr=subprocess.DEVNULL)
    except (FileNotFoundError, subprocess.SubprocessError):
        return []
    rows = []
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or parts[0] != "TCP":
            continue
        local, state, pid = parts[1], parts[3], parts[-1]
        if state != "LISTENING":
            continue
        if port is not None and not local.endswith(f":{port}"):
            continue
        rows.append({"local": local, "pid": pid})
    return rows


def server_responds(port: int = DEFAULT_PORT) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/people", timeout=0.4) as response:
            return 200 <= response.status < 500
    except (OSError, urllib.error.URLError):
        return False


def ensure_server_running(port: int = DEFAULT_PORT) -> None:
    if server_responds(port) or server_sessions(port):
        return
    creationflags = subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve().parent / "server.py")],
        cwd=Path(__file__).resolve().parent,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    for _ in range(20):
        if server_responds(port) or server_sessions(port):
            return
        time.sleep(0.1)


def cmd_gui(args: argparse.Namespace) -> None:
    ensure_server_running(args.port)
    webbrowser.open(f"http://127.0.0.1:{args.port}")


def cmd_shell(_: argparse.Namespace) -> None:
    ensure_server_running()
    parser = build_parser()
    print("Assabile CLI shell. Type help, gui, search <term>, profile <id>, download ..., or exit.")
    while True:
        try:
            line = input("assabile-cli> ").strip()
        except EOFError:
            print()
            return
        if not line:
            continue
        if line.lower() in {"exit", "quit"}:
            return
        if line.lower() in {"help", "?"}:
            parser.print_help()
            continue
        try:
            args = parser.parse_args(shlex.split(line))
            if getattr(args, "func", None) is cmd_shell:
                print("Already in the CLI shell.")
                continue
            args.func(args)
        except SystemExit as exc:
            if exc.code not in (0, None):
                print(f"Command failed: {exc.code}")


def cmd_servers(args: argparse.Namespace) -> None:
    sessions = server_sessions(args.port)
    if args.action == "list":
        for row in sessions:
            print(f"{row['pid']}\t{row['local']}")
        if os.name != "nt" or not shutil.which("netstat"):
            print("Listener discovery unavailable on this platform.")
        print(f"{len(sessions)} server listener(s)")
        return
    targets = []
    if args.pid:
        targets = [str(args.pid)]
    elif args.all or args.all_other:
        current = str(os.getpid())
        targets = [row["pid"] for row in sessions if not args.all_other or row["pid"] != current]
    else:
        raise SystemExit("Use --pid, --all, or --all-other with servers stop.")
    for pid in sorted(set(targets)):
        subprocess.call(["taskkill", "/PID", pid, "/F"])


def cmd_sync(args: argparse.Namespace) -> None:
    command = [sys.executable, "scripts\\sync_catalog.py"]
    if args.refresh:
        command.append("--refresh")
    if args.max_profiles:
        command += ["--max-profiles", str(args.max_profiles)]
    subprocess.check_call(command)


def cmd_search(args: argparse.Namespace) -> None:
    term = (args.query or "").lower()
    rows = []
    media_filter_active = any(
        [
            args.kind != "all",
            args.surah,
            args.riwaya,
            args.collection,
            args.album,
            args.revelation,
        ]
    )
    for person in load_people():
        if args.country and not text_match(person.get("country", ""), args.country):
            continue
        person_match = term and term in " ".join([person.get("name", ""), person.get("arabicName", ""), person.get("country", "")]).lower()
        if args.people or (person_match and not media_filter_active):
            if person_match or not term:
                rows.append(("person", person["id"], person["name"], person.get("country", "")))
        if args.people:
            continue
        for track in filter_tracks(iter_tracks(person), args):
            rows.append((track["kind"], track["personId"], track["personName"], track.get("title", ""), track.get("collection") or track.get("album") or track.get("riwayah", "")))
    shown, page, total_pages = page_rows(rows, args.page, args.per_page)
    for row in shown:
        print("\t".join(row))
    print(f"page {page}/{total_pages}; {len(shown)} shown / {len(rows)} matches")


def cmd_list(args: argparse.Namespace) -> None:
    args.people = True
    cmd_search(args)


def cmd_profile(args: argparse.Namespace) -> None:
    people = {p["id"]: p for p in load_people()}
    person = people.get(args.person)
    if not person:
        raise SystemExit(f"Profile not found: {args.person}")
    print(json.dumps(person if args.json else {
        "id": person["id"],
        "name": person["name"],
        "country": person.get("country", ""),
        "tabs": person.get("tabs", {}),
        "counts": {
            "recitations": len(person.get("recitations", [])),
            "anasheedAlbums": len(person.get("albums", [])),
            "audioLessons": sum(len(s.get("recordings", [])) for s in person.get("audioLessons", [])),
            "videoLessons": sum(len(s.get("recordings", [])) for s in person.get("videoLessons", [])),
            "photos": len(person.get("photos", [])),
            "videos": len(person.get("videos", [])),
        },
    }, ensure_ascii=False, indent=2))


def get_person(person_id: str) -> dict:
    people = {p["id"]: p for p in load_people()}
    person = people.get(person_id)
    if not person:
        raise SystemExit(f"Profile not found: {person_id}")
    return person


def select_track(person: dict, args: argparse.Namespace) -> dict:
    tracks = filter_tracks(iter_tracks(person), args, include_query=False)
    if args.index:
        for track in tracks:
            if track.get("index") == args.index:
                return track
        raise SystemExit(f"Track index not found: {args.index}")
    term = (args.query or "").lower()
    matches = filter_tracks(tracks, args) if term else tracks
    if not matches:
        raise SystemExit("No matching track found.")
    if len(matches) > 1 and not args.first:
        for track in matches[:20]:
            print(f"{track['index']}\t{track['kind']}\t{track.get('title','')}\t{track.get('album','')}")
        raise SystemExit("Multiple matches. Use --index or --first.")
    return matches[0]


def cmd_tracks(args: argparse.Namespace) -> None:
    person = get_person(args.person)
    rows = filter_tracks(iter_tracks(person), args)
    shown, page, total_pages = page_rows(rows, args.page, args.per_page)
    for row in shown:
        meta = row.get("collection") or row.get("album") or row.get("riwayah") or row.get("revelation") or ""
        print(f"{row['index']}\t{row['kind']}\t{row.get('title','')}\t{meta}")
    print(f"page {page}/{total_pages}; {len(shown)} shown / {len(rows)} tracks")


def cmd_play(args: argparse.Namespace) -> None:
    person = get_person(args.person)
    track = select_track(person, args)
    if track.get("playerXml"):
        resolved = server.resolve_player_xml(track["playerXml"])
        track = {**track, **resolved}
    media_url = track.get("mediaUrl")
    if not media_url:
        raise SystemExit("Selected track has no playable media URL.")
    suffix = Path(media_url.split("?", 1)[0]).suffix or ".mp3"
    filename = server.safe_filename(f"{person.get('name','profile')} - {track.get('title','track')}{suffix}")
    saved = server.download_media(media_url, filename, person["id"])
    local_url = f"http://127.0.0.1:{args.port}{saved['publicPath']}"
    print(local_url)
    if not args.no_open:
        ensure_server_running(args.port)
        webbrowser.open(local_url)


def cmd_download(args: argparse.Namespace) -> None:
    result = server.bulk_download({"personIds": args.person, "kinds": args.kind, "name": args.name or "-".join(args.person + args.kind)})
    print(json.dumps(result, indent=2))


def cmd_library(_: argparse.Namespace) -> None:
    server.ensure_dirs()
    for path in server.DOWNLOADS.rglob("*"):
        if server.is_download_payload_file(path):
            print(f"{path.relative_to(server.ROOT)}\t{path.stat().st_size}")


def cmd_cache(args: argparse.Namespace) -> None:
    if args.action == "info":
        server.ensure_dirs()
        files = [path for path in server.DOWNLOADS.rglob("*") if server.is_download_payload_file(path)]
        total = sum(path.stat().st_size for path in files)
        print(f"{len(files)} files\t{total} bytes\t{server.DOWNLOADS.relative_to(server.ROOT)}")
        return
    if args.action == "clear":
        if not args.yes:
            print("This will delete all cached/downloaded media and ZIP files under data/downloads/.")
            answer = input("Type YES to clear the download cache: ").strip()
            if answer != "YES":
                print("Cache clear cancelled.")
                return
        result = server.clear_download_cache()
        print(f"Cleared {result['files']} files / {result['bytes']} bytes from {result['path']}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Assabile Local command line utility")
    sub = parser.add_subparsers(required=True)
    serve = sub.add_parser("serve", help="Run the local web server")
    serve.add_argument("--host", default=None, help="Bind host, default ASSABILE_HOST or 0.0.0.0")
    serve.add_argument("--port", type=int, default=None, help="Bind port, default ASSABILE_PORT or 8765")
    serve.set_defaults(func=cmd_serve)
    gui = sub.add_parser("gui", help="Start the server if needed and open the web UI")
    gui.add_argument("--port", type=int, default=DEFAULT_PORT)
    gui.set_defaults(func=cmd_gui)
    shell = sub.add_parser("shell", help="Start the server if needed and open an interactive CLI")
    shell.set_defaults(func=cmd_shell)
    servers = sub.add_parser("servers", help="List or stop Assabile server listeners")
    servers.add_argument("action", choices=["list", "stop"])
    servers.add_argument("--port", type=int, default=8765)
    servers.add_argument("--pid", type=int)
    servers.add_argument("--all", action="store_true")
    servers.add_argument("--all-other", action="store_true")
    servers.set_defaults(func=cmd_servers)
    sync = sub.add_parser("sync", help="Refresh catalogue metadata")
    sync.add_argument("--refresh", action="store_true", help="Ignore cached Assabile pages")
    sync.add_argument("--max-profiles", type=int)
    sync.set_defaults(func=cmd_sync)
    search = sub.add_parser("search", help="Search profiles and tracks")
    search.add_argument("query", nargs="?", default="")
    add_track_filter_args(search, include_person_filters=True)
    search.add_argument("--people", action="store_true")
    search.add_argument("--page", type=int, default=1)
    search.add_argument("--per-page", type=int, default=80)
    search.set_defaults(func=cmd_search)
    list_cmd = sub.add_parser("list", help="Alias for people search")
    list_cmd.add_argument("query", nargs="?", default="")
    add_track_filter_args(list_cmd, include_person_filters=True)
    list_cmd.add_argument("--page", type=int, default=1)
    list_cmd.add_argument("--per-page", type=int, default=80)
    list_cmd.set_defaults(func=cmd_list)
    profile = sub.add_parser("profile", help="Show profile metadata")
    profile.add_argument("person")
    profile.add_argument("--json", action="store_true")
    profile.set_defaults(func=cmd_profile)
    tracks = sub.add_parser("tracks", help="List playable tracks/videos for a profile")
    tracks.add_argument("person")
    tracks.add_argument("query", nargs="?", default="", help="Optional title/filter text")
    add_track_filter_args(tracks)
    tracks.add_argument("--page", type=int, default=1)
    tracks.add_argument("--per-page", type=int, default=80)
    tracks.set_defaults(func=cmd_tracks)
    play = sub.add_parser("play", help="Cache and open a profile track/video")
    play.add_argument("person")
    play.add_argument("query", nargs="?", default="", help="Title search; omit when using --index")
    add_track_filter_args(play)
    play.add_argument("--index", type=int, default=0, help="Track index from the tracks command")
    play.add_argument("--first", action="store_true", help="Play the first query match when there are multiple matches")
    play.add_argument("--port", type=int, default=DEFAULT_PORT)
    play.add_argument("--no-open", action="store_true", help="Print the local cached URL without opening it")
    play.set_defaults(func=cmd_play)
    download = sub.add_parser("download", help="Download one or more profiles as a ZIP")
    download.add_argument("--person", action="append", required=True, help="Profile id; can be repeated")
    download.add_argument("--kind", action="append", default=["all"], help="all, recitations, anasheed, audioLessons, videoLessons, photos, videos")
    download.add_argument("--name", default="")
    download.set_defaults(func=cmd_download)
    library = sub.add_parser("library", help="List downloaded files")
    library.set_defaults(func=cmd_library)
    cache = sub.add_parser("cache", help="Inspect or clear the permanent download cache")
    cache.add_argument("action", choices=["info", "clear"])
    cache.add_argument("--yes", action="store_true", help="Skip confirmation for cache clear")
    cache.set_defaults(func=cmd_cache)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
