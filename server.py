from __future__ import annotations

import html
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
import zipfile
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
CACHE = DATA / "cache"
DOWNLOADS = DATA / "downloads"
MEDIA_CACHE_INDEX = DOWNLOADS / "_media_cache.json"
CATALOG_PATH = DATA / "catalog.json"
DOCS = ROOT / "docs"
ASSABILE_ORIGIN = "https://www.assabile.com"
ASSABILE_FALLBACK_ORIGINS = ("https://ar.assabile.com", "https://fr.assabile.com", "https://es.assabile.com")
SURAH_NAMES = {
    1: "Al-Fatiha",
    2: "Al-Baqara",
    3: "Aal-e-Imran",
    4: "An-Nisa",
    5: "Al-Maeda",
    6: "Al-Anaam",
    7: "Al-Araf",
    8: "Al-Anfal",
    9: "At-Taubah",
    10: "Yunus",
    11: "Hud",
    12: "Yusuf",
    13: "Ar-Rad",
    14: "Ibrahim",
    15: "Al-Hijr",
    16: "An-Nahl",
    17: "Al-Isra",
    18: "Al-Kahf",
    19: "Maryam",
    20: "Taha",
    21: "Al-Anbiya",
    22: "Al-Hajj",
    23: "Al-Mumenoon",
    24: "An-Noor",
    25: "Al-Furqan",
    26: "Ash-Shuara",
    27: "An-Naml",
    28: "Al-Qasas",
    29: "Al-Ankaboot",
    30: "Ar-Room",
    31: "Luqman",
    32: "As-Sajda",
    33: "Al-Ahzab",
    34: "Saba",
    35: "Fatir",
    36: "Ya Seen",
    37: "As-Saaffat",
    38: "Sad",
    39: "Az-Zumar",
    40: "Ghafir",
    41: "Fussilat",
    42: "Ash-Shura",
    43: "Az-Zukhruf",
    44: "Ad-Dukhan",
    45: "Al-Jathiya",
    46: "Al-Ahqaf",
    47: "Muhammad",
    48: "Al-Fath",
    49: "Al-Hujraat",
    50: "Qaf",
    51: "Adh-Dhariyat",
    52: "At-tur",
    53: "An-Najm",
    54: "Al-Qamar",
    55: "Al-Rahman",
    56: "Al-Waqia",
    57: "Al-Hadid",
    58: "Al-Mujadala",
    59: "Al-Hashr",
    60: "Al-Mumtahina",
    61: "As-Saff",
    62: "Al-Jumua",
    63: "Al-Munafiqoon",
    64: "At-Taghabun",
    65: "At-Talaq",
    66: "At-Tahrim",
    67: "Al-Mulk",
    68: "Al-Qalam",
    69: "Al-Haaqqa",
    70: "Al-Maarij",
    71: "Nooh",
    72: "Al-Jinn",
    73: "Al-Muzzammil",
    74: "Al-Muddathir",
    75: "Al-Qiyama",
    76: "Al-Insan",
    77: "Al-Mursalat",
    78: "An-Naba",
    79: "An-Naziat",
    80: "Abasa",
    81: "At-Takwir",
    82: "Al-Infitar",
    83: "Al-Mutaffifin",
    84: "Al-Inshiqaq",
    85: "Al-Burooj",
    86: "At-Tariq",
    87: "Al-Ala",
    88: "Al-Ghashiya",
    89: "Al-Fajr",
    90: "Al-Balad",
    91: "Ash-Shams",
    92: "Al-Lail",
    93: "Ad-Dhuha",
    94: "Ash-Sharh",
    95: "At-Tin",
    96: "Al-Alaq",
    97: "Al-Qadr",
    98: "Al-Bayyina",
    99: "Al-Zalzala",
    100: "Al-Adiyat",
    101: "Al-Qaria",
    102: "At-Takathur",
    103: "Al-Asr",
    104: "Al-Humaza",
    105: "Al-Fil",
    106: "Quraish",
    107: "Al-Maun",
    108: "Al-Kauther",
    109: "Al-Kafiroon",
    110: "An-Nasr",
    111: "Al-Masadd",
    112: "Al-Ikhlas",
    113: "Al-Falaq",
    114: "An-Nas",
}
SURAH_ORDER = {name: number for number, name in SURAH_NAMES.items()}
CANONICAL_SURAHS = set(SURAH_ORDER)


def surah_sort_key(name: str) -> tuple[int, str]:
    return (SURAH_ORDER.get(name, 9999), name)


def ensure_dirs() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)


def load_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def fetch_url(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "AssabileLocal/1.0 (+local personal mirror)",
            "Accept": "*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def ajax_fallback_urls(url: str) -> list[str]:
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc != "www.assabile.com" or not parsed.path.startswith("/ajax/loadplayer-"):
        return []
    return [origin + parsed.path for origin in ASSABILE_FALLBACK_ORIGINS]


def parse_recitation_payload(raw: bytes) -> dict[str, Any]:
    text = raw.decode("utf-8", errors="ignore").lstrip()
    if not text.startswith("{"):
        raise ValueError("Assabile returned HTML instead of recitation JSON.")
    return json.loads(text)


def fetch_recitation_payload(url: str) -> tuple[dict[str, Any], str]:
    errors = []
    for candidate in [url, *ajax_fallback_urls(url)]:
        try:
            data = parse_recitation_payload(fetch_url(candidate))
            if data.get("Recitation"):
                return data, candidate
            errors.append(f"{candidate}: no recitation rows")
        except (ValueError, json.JSONDecodeError, urllib.error.URLError) as exc:
            errors.append(f"{candidate}: {exc}")
    raise ValueError("; ".join(errors) or "No recitation rows found.")


def safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._ -]+", "-", name).strip(" .-")
    return cleaned or "download"


def load_media_cache_index() -> dict[str, Any]:
    if not MEDIA_CACHE_INDEX.exists():
        return {"files": {}, "urls": {}}
    try:
        raw = json.loads(MEDIA_CACHE_INDEX.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"files": {}, "urls": {}}
    if "files" in raw or "urls" in raw:
        raw.setdefault("files", {})
        raw.setdefault("urls", {})
        return raw
    migrated = {"files": {}, "urls": {}}
    for relative, record in raw.items():
        if not isinstance(record, dict):
            continue
        migrated["files"][relative] = record
        if record.get("url"):
            migrated["urls"][record["url"]] = relative
    return migrated


def save_media_cache_index(index: dict[str, Any]) -> None:
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    MEDIA_CACHE_INDEX.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def cached_media_response(path: Path, relative: str, url: str, status: str) -> dict[str, str]:
    try:
        local_path = str(path.relative_to(ROOT))
    except ValueError:
        local_path = str(path)
    return {
        "path": local_path,
        "publicPath": f"/downloads/{relative}",
        "bytes": str(path.stat().st_size),
        "url": url,
        "cacheStatus": status,
    }


def prune_missing_media_cache_entries(index: dict[str, Any]) -> bool:
    changed = False
    files = index.setdefault("files", {})
    urls = index.setdefault("urls", {})
    for relative in list(files):
        if not (DOWNLOADS / relative).exists():
            url = files[relative].get("url") if isinstance(files[relative], dict) else ""
            files.pop(relative, None)
            if url and urls.get(url) == relative:
                urls.pop(url, None)
            changed = True
    for url, relative in list(urls.items()):
        if relative not in files:
            urls.pop(url, None)
            changed = True
    return changed


def is_download_payload_file(path: Path) -> bool:
    return path.is_file() and path.resolve() != MEDIA_CACHE_INDEX.resolve()


def cache_name(prefix: str, url: str, suffix: str) -> Path:
    key = re.sub(r"[^A-Za-z0-9]+", "-", url).strip("-").lower()
    return CACHE / f"{prefix}-{key[:120]}.{suffix}"


def resolve_player_xml(xml_url: str) -> dict[str, str]:
    if xml_url.startswith("/"):
        xml_url = ASSABILE_ORIGIN + xml_url
    cached = cache_name("player", xml_url, "xml")
    if cached.exists():
        raw = cached.read_text(encoding="utf-8", errors="ignore")
    else:
        raw = fetch_url(xml_url).decode("utf-8", errors="ignore")
        cached.write_text(raw, encoding="utf-8")

    location = re.search(r"<location>(.*?)</location>", raw, re.I | re.S)
    title = re.search(r"<title>(.*?)</title>", raw, re.I | re.S)
    creator = re.search(r"<creator>(.*?)</creator>", raw, re.I | re.S)
    if not location:
        raise ValueError("No media location found in player XML.")
    return {
        "source": xml_url,
        "mediaUrl": location.group(1).strip(),
        "title": title.group(1).strip() if title else "Untitled recitation",
        "creator": creator.group(1).strip() if creator else "",
    }


def absolute_assabile_url(value: str) -> str:
    if value.startswith("//"):
        return "https:" + value
    return urllib.parse.urljoin(ASSABILE_ORIGIN, value)


def strip_html(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def extract_attr(tag: str, attr: str) -> str:
    match = re.search(rf"\s{re.escape(attr)}=[\"']([^\"']*)[\"']", tag, re.I)
    return html.unescape(match.group(1)).strip() if match else ""


def playlist_tracks(xml_url: str) -> list[dict[str, str]]:
    raw = fetch_url(xml_url).decode("utf-8", errors="ignore")
    tracks = []
    for index, block in enumerate(re.findall(r"<track>(.*?)</track>", raw, re.I | re.S), start=1):
        location = re.search(r"<location>(.*?)</location>", block, re.I | re.S)
        if not location:
            continue
        title = re.search(r"<title>(.*?)</title>", block, re.I | re.S)
        creator = re.search(r"<creator>(.*?)</creator>", block, re.I | re.S)
        identifier = re.search(r"<identifier>(.*?)</identifier>", block, re.I | re.S)
        media_url = html.unescape(strip_html(location.group(1)))
        tracks.append(
            {
                "id": identifier.group(1).strip() if identifier else str(index),
                "title": strip_html(title.group(1)) if title else Path(urllib.parse.urlparse(media_url).path).stem,
                "creator": strip_html(creator.group(1)) if creator else "",
                "duration": "",
                "mediaUrl": media_url,
                "source": xml_url,
            }
        )
    return tracks


def direct_html_tracks(page_url: str, text: str) -> list[dict[str, str]]:
    tracks = []
    pattern = re.compile(r"(<a\b[^>]*href=[\"']([^\"']+\.mp3[^\"']*)[\"'][^>]*>)(.*?)</a>", re.I | re.S)
    for index, match in enumerate(pattern.finditer(text), start=1):
        tag, href, body = match.group(1), html.unescape(match.group(2)), match.group(3)
        title = strip_html(body) or Path(urllib.parse.urlparse(href).path).stem
        tracks.append(
            {
                "id": extract_attr(tag, "data-rbug") or str(index),
                "title": title,
                "creator": "",
                "duration": extract_attr(tag, "data-duration"),
                "mediaUrl": absolute_assabile_url(href),
                "source": page_url,
            }
        )
    return tracks


def sync_recordings(source_url: str) -> dict[str, Any]:
    source_url = absolute_assabile_url(source_url)
    cached = cache_name("recordings", source_url, "html")
    if cached.exists():
        text = cached.read_text(encoding="utf-8", errors="ignore")
    else:
        text = fetch_url(source_url).decode("utf-8", errors="ignore")
        cached.write_text(text, encoding="utf-8")

    tracks = []
    xml_match = re.search(r"urlXML=([^&\"']+)", text, re.I)
    if xml_match:
        xml_url = absolute_assabile_url(urllib.parse.unquote(html.unescape(xml_match.group(1))))
        tracks = playlist_tracks(xml_url)
    if not tracks:
        tracks = direct_html_tracks(source_url, text)
    return {"source": source_url, "count": len(tracks), "recordings": tracks}


def sync_recitations(ajax_url: str) -> dict[str, Any]:
    if ajax_url.startswith("/"):
        ajax_url = ASSABILE_ORIGIN + ajax_url
    data, source_url = fetch_recitation_payload(ajax_url)
    cached = cache_name("recitations", source_url, "json")
    cached.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    rows = data.get("Recitation", [])
    normalized = []
    for row in rows:
        rec_id = str(row.get("link_person", "")).rstrip("/").split("-")[-1]
        surah_number = str(row.get("sura_id", "")).strip()
        surah = SURAH_NAMES.get(int(surah_number), str(row.get("span_name", "")).strip()) if surah_number.isdigit() else str(row.get("span_name", "")).strip()
        revelation = str(row.get("class1") or row.get("stats-kind", "")).strip()
        normalized.append(
            {
                "id": rec_id,
                "surah": surah,
                "number": surah_number,
                "duration": str(row.get("duration", "")).strip(),
                "revelation": revelation,
                "riwayah": str(row.get("data-riwaya", "")).strip(),
                "collectionId": str(row.get("data-collection", "")).strip(),
                "verses": str(row.get("data-verset", "")).strip(),
                "chronological": str(row.get("data-chronological", "")).strip(),
                "listens": str(row.get("data-sort", "")).strip(),
                "comments": str(row.get("stats-comment", "")).strip(),
                "detailPath": str(row.get("link_person", "")).strip(),
                "playerXml": f"{ASSABILE_ORIGIN}/player/onerecitation-{rec_id}.xml" if rec_id else "",
            }
        )
    return {"source": source_url, "requested": ajax_url, "cache": str(cached.relative_to(ROOT)), "count": len(normalized), "recitations": normalized}


def download_media(url: str, filename: str | None = None, subdir: str = "media") -> dict[str, str]:
    if not re.match(r"^https?://", url):
        raise ValueError("Only absolute http(s) URLs can be downloaded.")
    parsed = urllib.parse.urlparse(url)
    guessed = Path(parsed.path).name or "download"
    target_name = safe_filename(filename or guessed)
    target_dir = DOWNLOADS / safe_filename(subdir)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / target_name
    relative = target.relative_to(DOWNLOADS).as_posix()
    index = load_media_cache_index()
    if prune_missing_media_cache_entries(index):
        save_media_cache_index(index)
    files = index.setdefault("files", {})
    urls = index.setdefault("urls", {})

    existing_relative = urls.get(url)
    if existing_relative:
        existing = DOWNLOADS / existing_relative
        if existing.exists():
            return cached_media_response(existing, existing_relative, url, "hit")
        urls.pop(url, None)
        files.pop(existing_relative, None)

    record = files.get(relative, {})
    if target.exists() and record.get("url") == url:
        urls[url] = relative
        save_media_cache_index(index)
        return cached_media_response(target, relative, url, "hit")
    if target.exists() and not record.get("url"):
        files[relative] = {"url": url, "bytes": target.stat().st_size}
        urls[url] = relative
        save_media_cache_index(index)
        return cached_media_response(target, relative, url, "adopted")
    request = urllib.request.Request(url, headers={"User-Agent": "AssabileLocal/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response, target.open("wb") as f:
        shutil.copyfileobj(response, f)
    old_url = record.get("url") if isinstance(record, dict) else ""
    if old_url and urls.get(old_url) == relative:
        urls.pop(old_url, None)
    files[relative] = {"url": url, "bytes": target.stat().st_size}
    urls[url] = relative
    save_media_cache_index(index)
    return cached_media_response(target, relative, url, "updated" if old_url and old_url != url else "miss")


def media_filename(item: dict[str, Any], fallback_ext: str = "") -> str:
    url = str(item.get("url") or item.get("mediaUrl") or "")
    ext = Path(urllib.parse.urlparse(url).path).suffix or fallback_ext
    title = str(item.get("title") or item.get("filename") or Path(urllib.parse.urlparse(url).path).stem or "media")
    return safe_filename(title + (ext if not title.lower().endswith(ext.lower()) else ""))


def profile_media_items(person: dict[str, Any], kinds: set[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    include_all = not kinds or "all" in kinds
    if include_all or "recitations" in kinds:
        for recitation in person.get("recitations", []):
            if recitation.get("playerXml"):
                items.append({"kind": "recitations", "title": recitation.get("surah", "recitation"), "playerXml": recitation.get("playerXml", "")})
    if include_all or "anasheed" in kinds:
        for album in person.get("albums", []):
            for recording in album.get("recordings", []):
                if recording.get("mediaUrl"):
                    items.append({"kind": "anasheed", "title": recording.get("title", "anasheed"), "url": recording.get("mediaUrl", "")})
    if include_all or "audioLessons" in kinds:
        for series in person.get("audioLessons", []):
            for recording in series.get("recordings", []):
                if recording.get("mediaUrl"):
                    items.append({"kind": "audio-lessons", "title": recording.get("title", "audio lesson"), "url": recording.get("mediaUrl", "")})
    if include_all or "videoLessons" in kinds:
        for series in person.get("videoLessons", []):
            for recording in series.get("recordings", []):
                if recording.get("mediaUrl"):
                    items.append({"kind": "video-lessons", "title": recording.get("title", "video lesson"), "url": recording.get("mediaUrl", "")})
    if include_all or "videos" in kinds:
        for video in person.get("videos", []):
            if video.get("mediaUrl"):
                items.append({"kind": "videos", "title": video.get("title", "video"), "url": video.get("mediaUrl", "")})
    if include_all or "photos" in kinds:
        for photo in person.get("photos", []):
            if photo.get("full"):
                items.append({"kind": "photos", "title": photo.get("title", "photo"), "url": photo.get("full", "")})
    return items


def clear_download_cache() -> dict[str, Any]:
    ensure_dirs()
    count = 0
    bytes_removed = 0
    if DOWNLOADS.exists():
        for path in DOWNLOADS.rglob("*"):
            if is_download_payload_file(path):
                count += 1
                bytes_removed += path.stat().st_size
        shutil.rmtree(DOWNLOADS)
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    return {"files": count, "bytes": bytes_removed, "path": str(DOWNLOADS.relative_to(ROOT))}


def bulk_download(payload: dict[str, Any]) -> dict[str, Any]:
    catalog = load_catalog()
    people_by_id = {p.get("id"): p for p in catalog.get("people", [])}
    person_ids = [str(item) for item in payload.get("personIds", []) if str(item) in people_by_id]
    kinds = {str(item) for item in payload.get("kinds", [])}
    raw_items = payload.get("items", [])
    items: list[dict[str, Any]] = []
    for person_id in person_ids:
        person = people_by_id[person_id]
        for item in profile_media_items(person, kinds):
            item["personId"] = person_id
            item["personName"] = person.get("name", person_id)
            items.append(item)
    for raw in raw_items:
        if isinstance(raw, dict):
            items.append(raw)
    if not items:
        raise ValueError("No downloadable media matched this request.")

    bundle_name = safe_filename(str(payload.get("name") or "assabile-bundle"))
    staging = safe_filename(f"bulk/{bundle_name}")
    downloaded: list[dict[str, str]] = []
    for index, item in enumerate(items, start=1):
        person_name = safe_filename(str(item.get("personName") or item.get("personId") or "assabile"))
        kind = safe_filename(str(item.get("kind") or "media"))
        if item.get("playerXml"):
            media = resolve_player_xml(str(item["playerXml"]))
            media["title"] = item.get("title") or media.get("title")
            media["creator"] = item.get("personName") or media.get("creator")
            url = media["mediaUrl"]
            filename = media_filename({"url": url, "title": f"{index:04d} {media.get('title', 'recitation')}"}, ".mp3")
        else:
            url = str(item.get("url") or item.get("mediaUrl") or "")
            filename = media_filename({"url": url, "title": f"{index:04d} {item.get('title', 'media')}"})
        if not url:
            continue
        downloaded.append(download_media(url, filename, f"{staging}/{person_name}/{kind}"))

    if not downloaded:
        raise ValueError("No media files could be downloaded.")

    zip_dir = DOWNLOADS / "zips"
    zip_dir.mkdir(parents=True, exist_ok=True)
    zip_path = zip_dir / f"{bundle_name}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for saved in downloaded:
            path = (ROOT / saved["path"]).resolve()
            if path.exists() and DOWNLOADS.resolve() in path.parents:
                archive.write(path, path.relative_to(DOWNLOADS / staging))
    relative = zip_path.relative_to(DOWNLOADS).as_posix()
    return {"count": len(downloaded), "path": str(zip_path.relative_to(ROOT)), "publicPath": f"/downloads/{relative}", "bytes": str(zip_path.stat().st_size)}


class Handler(SimpleHTTPRequestHandler):
    server_version = "AssabileLocal/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/people":
            catalog = load_catalog()
            countries = sorted({p.get("country", "") for p in catalog["people"] if p.get("country")})
            riwayat = set()
            revelations = set()
            surahs = set()
            tracks = []
            for p in catalog["people"]:
                for collection in p.get("collections", []):
                    if collection.get("riwayah"):
                        riwayat.add(collection["riwayah"])
                for recitation in p.get("recitations", []):
                    if recitation.get("riwayah"):
                        riwayat.add(recitation["riwayah"])
                    if recitation.get("revelation"):
                        revelations.add(recitation["revelation"])
                    if recitation.get("surah"):
                        surahs.add(recitation["surah"])
                    tracks.append(
                        {
                            "kind": "recitation",
                            "personId": p["id"],
                            "personName": p["name"],
                            "title": recitation.get("surah", ""),
                            "subtitle": recitation.get("riwayah", ""),
                            "revelation": recitation.get("revelation", ""),
                            "riwayah": recitation.get("riwayah", ""),
                            "id": recitation.get("id", ""),
                            "duration": recitation.get("duration", ""),
                            "playerXml": recitation.get("playerXml", ""),
                            "detailPath": recitation.get("detailPath", ""),
                            "detailUrl": f"https://www.assabile.com{recitation.get('detailPath', '')}" if recitation.get("detailPath") else "",
                        }
                    )
                for album in p.get("albums", []):
                    for recording in album.get("recordings", []):
                        tracks.append(
                            {
                                "kind": "anasheed",
                                "personId": p["id"],
                                "personName": p["name"],
                                "title": recording.get("title", ""),
                                "subtitle": album.get("title", ""),
                                "revelation": "",
                                "riwayah": "",
                                "id": recording.get("mediaUrl", ""),
                                "mediaUrl": recording.get("mediaUrl", ""),
                                "source": recording.get("source", ""),
                                "sourceUrl": recording.get("source", "") or album.get("url", ""),
                            }
                        )
                for series in p.get("audioLessons", []):
                    for recording in series.get("recordings", []):
                        tracks.append(
                            {
                                "kind": "audioLesson",
                                "personId": p["id"],
                                "personName": p["name"],
                                "title": recording.get("title", ""),
                                "subtitle": series.get("title", ""),
                                "revelation": "",
                                "riwayah": "",
                                "id": recording.get("mediaUrl", ""),
                                "mediaUrl": recording.get("mediaUrl", ""),
                                "source": recording.get("source", ""),
                                "sourceUrl": recording.get("source", "") or series.get("url", ""),
                            }
                        )
                for series in p.get("videoLessons", []):
                    for recording in series.get("recordings", []):
                        tracks.append(
                            {
                                "kind": "videoLesson",
                                "personId": p["id"],
                                "personName": p["name"],
                                "title": recording.get("title", ""),
                                "subtitle": series.get("title", ""),
                                "revelation": "",
                                "riwayah": "",
                                "id": recording.get("mediaUrl", "") or recording.get("url", ""),
                                "mediaUrl": recording.get("mediaUrl", ""),
                                "thumb": recording.get("thumb", ""),
                                "source": recording.get("url", ""),
                                "sourceUrl": recording.get("url", "") or series.get("url", ""),
                            }
                        )
            people = [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "arabicName": p.get("arabicName", ""),
                    "country": p.get("country", ""),
                    "roles": p.get("roles", []),
                    "image": p.get("image", ""),
                    "banner": p.get("banner", ""),
                    "bio": p.get("bio", ""),
                    "profileUrl": p.get("profileUrl", ""),
                    "tabs": p.get("tabs", {}),
                    "riwayat": sorted(
                        {
                            *[r.get("riwayah", "") for r in p.get("recitations", []) if r.get("riwayah")],
                            *[c.get("riwayah", "") for c in p.get("collections", []) if c.get("riwayah")],
                        }
                    ),
                    "revelations": sorted({r.get("revelation", "") for r in p.get("recitations", []) if r.get("revelation")}),
                    "surahs": sorted({r.get("surah", "") for r in p.get("recitations", []) if r.get("surah") in CANONICAL_SURAHS}, key=surah_sort_key),
                }
                for p in catalog["people"]
            ]
            return self.send_json(
                {
                    "people": people,
                    "filters": {"countries": countries, "riwayat": sorted(riwayat), "revelations": sorted(revelations), "surahs": sorted((s for s in surahs if s in CANONICAL_SURAHS), key=surah_sort_key)},
                    "tracks": tracks,
                }
            )

        person_match = re.match(r"^/api/person/([^/]+)$", parsed.path)
        if person_match:
            person_id = urllib.parse.unquote(person_match.group(1))
            catalog = load_catalog()
            for person in catalog["people"]:
                if person["id"] == person_id:
                    return self.send_json(person)
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Person not found.")

        if parsed.path == "/api/library":
            ensure_dirs()
            files = []
            for path in DOWNLOADS.rglob("*"):
                if is_download_payload_file(path):
                    files.append({"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size})
            return self.send_json({"files": files})

        if parsed.path == "/api/docs":
            controls = DOCS / "CONTROLS.md"
            text = controls.read_text(encoding="utf-8") if controls.exists() else "No controls documentation found."
            return self.send_json({"title": "Controls", "body": text})

        download_path = parsed.path.removeprefix("/downloads/")
        if parsed.path.startswith("/downloads/") and download_path:
            candidate = (DOWNLOADS / urllib.parse.unquote(download_path)).resolve()
            if candidate.exists() and candidate.is_file() and (candidate == DOWNLOADS.resolve() or DOWNLOADS.resolve() in candidate.parents):
                return self.serve_file(candidate)
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Downloaded file not found.")

        if parsed.path == "/":
            return self.serve_file(PUBLIC / "index.html")

        static_path = (PUBLIC / parsed.path.lstrip("/")).resolve()
        if PUBLIC in static_path.parents and static_path.exists() and static_path.is_file():
            return self.serve_file(static_path)

        return self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            payload = self.read_json()
            if parsed.path == "/api/sync/player":
                return self.send_json(resolve_player_xml(str(payload.get("playerXml", ""))))
            if parsed.path == "/api/sync/recitations":
                return self.send_json(sync_recitations(str(payload.get("ajaxUrl", ""))))
            if parsed.path == "/api/sync/recordings":
                return self.send_json(sync_recordings(str(payload.get("sourceUrl", ""))))
            if parsed.path == "/api/download":
                return self.send_json(
                    download_media(
                        str(payload.get("url", "")),
                        payload.get("filename"),
                        str(payload.get("subdir", "media")),
                    )
                )
            if parsed.path == "/api/bulk-download":
                return self.send_json(bulk_download(payload))
            return self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found.")
        except (ValueError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            message = str(exc) or exc.__class__.__name__
            return self.send_error_json(HTTPStatus.BAD_REQUEST, message)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def send_error_json(self, status: HTTPStatus, message: str) -> None:
        self.send_json({"error": message}, status)

    def serve_file(self, path: Path) -> None:
        mime = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        size = path.stat().st_size
        start = 0
        end = size - 1
        status = HTTPStatus.OK
        range_header = self.headers.get("Range")
        if range_header:
            match = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
            if not match:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            raw_start, raw_end = match.groups()
            if raw_start:
                start = int(raw_start)
                end = int(raw_end) if raw_end else end
            elif raw_end:
                suffix_length = int(raw_end)
                start = max(0, size - suffix_length)
            if start >= size or end < start:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.end_headers()
                return
            end = min(end, size - 1)
            status = HTTPStatus.PARTIAL_CONTENT
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        try:
            self.end_headers()
            with path.open("rb") as f:
                f.seek(start)
                remaining = length
                while remaining:
                    chunk = f.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return


def main(host: str | None = None, port: int | None = None) -> None:
    ensure_dirs()
    host = host or os.environ.get("ASSABILE_HOST", "0.0.0.0")
    port = int(port or os.environ.get("ASSABILE_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Assabile Local running at http://{host}:{port}")
    print("Downloads will be saved under data/downloads/")
    print("Server prompt: type 'gui', 'cli', 'help', or 'stop'.")
    if not sys.stdin.isatty():
        server.serve_forever()
        return
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    public_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    try:
        while True:
            try:
                command = input("assabile> ").strip().lower()
            except EOFError:
                thread.join()
                return
            if command in {"", "help", "?"}:
                print("Commands: gui/open, cli/shell, stop/exit/quit")
            elif command in {"gui", "open", "web", "webui"}:
                webbrowser.open(f"http://{public_host}:{port}")
            elif command in {"cli", "shell"}:
                cli_path = ROOT / "assabile_cli.py"
                if cli_path.exists():
                    subprocess.call([sys.executable, str(cli_path), "shell"])
                else:
                    print("CLI entrypoint is not installed in this bundle.")
            elif command in {"stop", "exit", "quit"}:
                break
            else:
                print("Unknown command. Type 'help' for commands.")
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
