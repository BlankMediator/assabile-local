from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import SURAH_NAMES

DATA = ROOT / "data"
CACHE = DATA / "cache"
PAGE_CACHE = CACHE / "pages"
CATALOG_PATH = DATA / "catalog.json"
ORIGIN = "https://www.assabile.com"
FALLBACK_ORIGINS = ("https://ar.assabile.com", "https://fr.assabile.com", "https://es.assabile.com")
PROFILE_RE = re.compile(r"^/([a-z0-9-]+-\d+)/([a-z0-9-]+)\.htm$", re.I)
LINK_RE = re.compile(r"<a\s+[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
H_RE = re.compile(r"<h([1-4])[^>]*>(.*?)</h\1>", re.I | re.S)
IMG_RE = re.compile(r"<img\s+[^>]*src=[\"']([^\"']+)[\"'][^>]*>", re.I | re.S)
BIO_SECTION_RE = re.compile(
    r"<div\b[^>]*(?:class|id)=[\"'][^\"']*\bentry_content\b[^\"']*\bbiosection\b[^\"']*[\"'][^>]*>(.*?)</div>",
    re.I | re.S,
)
ATTR_RE = re.compile(r"\s([a-zA-Z0-9_-]+)=[\"']([^\"']*)[\"']", re.S)


def strip_tags(value: str) -> str:
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", html.unescape(value)).strip()


def absolute_url(value: str) -> str:
    if value.startswith("//"):
        return "https:" + value
    return urllib.parse.urljoin(ORIGIN, value)


def local_path(url: str) -> str:
    parsed = urllib.parse.urlparse(absolute_url(url))
    return parsed.path or "/"


def cache_path(url: str) -> Path:
    key = re.sub(r"[^A-Za-z0-9]+", "-", absolute_url(url)).strip("-").lower()
    return PAGE_CACHE / f"{key[:180]}.html"


def fetch_text(url: str, delay: float, refresh: bool) -> str:
    PAGE_CACHE.mkdir(parents=True, exist_ok=True)
    cached = cache_path(url)
    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8", errors="ignore")
    request = urllib.request.Request(
        absolute_url(url),
        headers={
            "User-Agent": "AssabileLocalCatalogSync/1.0 (+metadata only)",
            "Accept": "text/html,application/json,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=40) as response:
        raw = response.read()
    text = raw.decode("utf-8", errors="ignore")
    cached.write_text(text, encoding="utf-8")
    if delay:
        time.sleep(delay)
    return text


def fetch_json(url: str, delay: float, refresh: bool) -> dict[str, Any]:
    errors = []
    for candidate in [url, *ajax_fallback_urls(url)]:
        try:
            text = fetch_text(candidate, delay=delay, refresh=refresh)
            if not text.lstrip().startswith("{"):
                raise json.JSONDecodeError("Assabile returned HTML instead of recitation JSON.", text, 0)
            data = json.loads(text)
            if data.get("Recitation"):
                return data
            errors.append(f"{candidate}: no recitation rows")
        except (urllib.error.URLError, json.JSONDecodeError) as exc:
            errors.append(f"{candidate}: {exc}")
    raise json.JSONDecodeError("; ".join(errors) or "No recitation rows found.", "", 0)


def ajax_fallback_urls(url: str) -> list[str]:
    parsed = urllib.parse.urlparse(absolute_url(url))
    if parsed.netloc != "www.assabile.com" or not parsed.path.startswith("/ajax/loadplayer-"):
        return []
    return [origin + parsed.path for origin in FALLBACK_ORIGINS]


def page_fallback_urls(url: str) -> list[str]:
    parsed = urllib.parse.urlparse(absolute_url(url))
    if parsed.netloc != "www.assabile.com":
        return []
    return [origin + parsed.path for origin in FALLBACK_ORIGINS]


def fetch_text_variants(url: str, delay: float, refresh: bool) -> list[tuple[str, str]]:
    variants: list[tuple[str, str]] = []
    for candidate in [url, *page_fallback_urls(url)]:
        try:
            variants.append((candidate, fetch_text(candidate, delay=delay, refresh=refresh)))
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                print(f"warn: failed fallback page {candidate}: {exc}")
        except urllib.error.URLError as exc:
            print(f"warn: failed fallback page {candidate}: {exc}")
    return variants


def extract_links(text: str) -> list[dict[str, str]]:
    links = []
    for match in LINK_RE.finditer(text):
        href = html.unescape(match.group(1)).strip()
        label = strip_tags(match.group(2))
        if href:
            links.append({"href": href, "path": local_path(href), "text": label})
    return links


def discover_listing_paths(section: str, text: str) -> set[str]:
    paths = {f"/{section}"}
    for link in extract_links(text):
        path = link["path"]
        if not path.startswith(f"/{section}"):
            continue
        if any(skip in path for skip in ("/collections", "/riwayat", "/suwar", "/topseries", "/lastseries")):
            continue
        if path in {f"/{section}/top", f"/{section}/0"}:
            continue
        if re.match(rf"^/{section}(/page:\d+)?$", path) or re.match(rf"^/{section}/[a-z0-9-]+(/page:\d+)?$", path, re.I):
            paths.add(path)
    return paths


def crawl_listing(section: str, delay: float, refresh: bool, max_pages: int | None) -> dict[str, str]:
    first_variants = fetch_text_variants(f"/{section}", delay=delay, refresh=refresh)
    if not first_variants:
        first_variants = [(f"/{section}", fetch_text(f"/{section}", delay=delay, refresh=refresh))]
    first_by_path = {local_path(url): text for url, text in first_variants}
    queue = sorted({path for _, text in first_variants for path in discover_listing_paths(section, text)})
    seen_pages: set[str] = set()
    profiles: dict[str, str] = {}

    while queue:
        path = queue.pop(0)
        if path in seen_pages:
            continue
        if max_pages and len(seen_pages) >= max_pages:
            break
        seen_pages.add(path)
        page_variants = [(path, first_by_path[path])] if path in first_by_path else fetch_text_variants(path, delay=delay, refresh=refresh)
        for _, text in page_variants:
            for link in extract_links(text):
                profile = PROFILE_RE.match(link["path"])
                if profile:
                    profiles[profile.group(1)] = link["path"]
                    continue
                next_path = link["path"]
                if next_path not in seen_pages and next_path not in queue:
                    if re.match(rf"^/{section}(/[a-z0-9-]+)?/page:\d+$", next_path, re.I):
                        queue.append(next_path)
    print(f"{section}: {len(profiles)} profiles from {len(seen_pages)} listing pages")
    return profiles


def parse_h1(text: str) -> tuple[str, str]:
    h1 = next((strip_tags(m.group(2)) for m in H_RE.finditer(text) if m.group(1) == "1"), "")
    if not h1:
        return "", ""
    arabic_match = re.search(r"([\u0600-\u06ff][\u0600-\u06ff\s]+)$", h1)
    if arabic_match:
        arabic = arabic_match.group(1).strip()
        name = h1[: arabic_match.start()].strip()
        return name or h1, arabic
    return h1, ""


def tab_counts(text: str, person_id: str) -> dict[str, int]:
    mapping = {
        "collection": "collections",
        "quran": "recitations",
        "album": "anasheed",
        "series-audio": "audioLessons",
        "series": "videoLessons",
        "photos": "photos",
        "videos": "videos",
    }
    tabs: dict[str, int] = {}
    for link in extract_links(text):
        path = link["path"].strip("/")
        if not path.startswith(person_id + "/"):
            continue
        suffix = path.split("/", 1)[1] if "/" in path else ""
        key = mapping.get(suffix)
        count = re.search(r"\((\d+)\)", link["text"])
        if key and count:
            tabs[key] = int(count.group(1))
    return tabs


def extract_person_image(text: str, slug: str) -> str:
    slug_images: list[str] = []
    for match in IMG_RE.finditer(text):
        src = html.unescape(match.group(1))
        if "/media/person/" in src and slug in src:
            slug_images.append(src)

    for size in ("/200x256/", "/280x219/"):
        for src in slug_images:
            if size in src:
                return absolute_url(src)

    for src in slug_images:
        if "/720x200/" not in src:
            return absolute_url(src)

    if slug_images:
        return absolute_url(slug_images[0])

    for match in IMG_RE.finditer(text):
        src = html.unescape(match.group(1))
        if "/media/person/" in src:
            return absolute_url(src)
    return ""


def extract_country(text: str) -> str:
    match = re.search(r"From the same country\s*</?[^>]*>\s*<a[^>]*>(.*?)</a>", text, re.I | re.S)
    if match:
        return strip_tags(match.group(1))
    plain = strip_tags(text)
    match = re.search(r"From the same country\s+([A-Za-z -]+)", plain)
    return match.group(1).strip() if match else ""


def extract_bio(text: str) -> str:
    for match in BIO_SECTION_RE.finditer(text):
        value = strip_tags(match.group(1))
        if value and len(value) > 30:
            return value

    pattern = r"<(?:div|section|article)\b[^>]*(?:class|id)=[\"'][^\"']*(?:bio|biography|description|content)[^\"']*[\"'][^>]*>(.*?)</(?:div|section|article)>"
    for match in re.finditer(pattern, text, re.I | re.S):
        value = strip_tags(match.group(1))
        if value and len(value) > 30:
            return value

    meta = re.search(r"<meta\b[^>]*(?:name|property)=[\"']description[\"'][^>]*content=[\"']([^\"']+)[\"']", text, re.I | re.S)
    if meta:
        value = strip_tags(meta.group(1))
        if value and len(value) > 30:
            return value
    return ""


def extract_banner(text: str) -> str:
    bio_marker = re.search(r"<div\b[^>]*class=[\"'][^\"']*\bentry_image\b[^\"']*[\"'][^>]*>(.*?)</div>", text, re.I | re.S)
    if bio_marker:
        match = IMG_RE.search(bio_marker.group(1))
        if match:
            return absolute_url(html.unescape(match.group(1)))

    for match in IMG_RE.finditer(text):
        src = html.unescape(match.group(1))
        lowered = src.lower()
        if any(token in lowered for token in ("720x200", "banner", "cover", "background")):
            return absolute_url(src)
    meta = re.search(r"<meta\b[^>]*property=[\"']og:image[\"'][^>]*content=[\"']([^\"']+)[\"']", text, re.I)
    if meta:
        url = html.unescape(meta.group(1))
        if "/media/person/" not in url:
            return absolute_url(url)
    return ""


def extract_same_country_links(text: str) -> list[dict[str, str]]:
    same_country: list[dict[str, str]] = []
    marker = re.search(r"From the same country(.*?)(?:<h\d|</section>|</aside>|$)", text, re.I | re.S)
    if not marker:
        return same_country
    for link in extract_links(marker.group(1)):
        if PROFILE_RE.match(link["path"]) and link["text"]:
            same_country.append({"title": link["text"], "url": absolute_url(link["path"])})
    return merge_unique([], same_country, key="url")


def extract_comments(text: str) -> list[dict[str, str]]:
    comments: list[dict[str, str]] = []
    blocks = re.findall(
        r"<li\b[^>]*class=[\"'][^\"']*\bcomment\b[^\"']*[\"'][^>]*>(.*?)(?=<li\b[^>]*class=[\"'][^\"']*\bcomment\b|</ol>)",
        text,
        re.I | re.S,
    )
    for block in blocks:
        author_match = re.search(r"<a\b[^>]*class=[\"'][^\"']*\bpseudo-comment\b[^\"']*[\"'][^>]*>(.*?)</a>", block, re.I | re.S)
        date_match = re.search(r"<span>\s*<a\b[^>]*href=[\"']#gotocomment-[^\"']+[\"'][^>]*>(.*?)</a>\s*</span>", block, re.I | re.S)
        body_match = re.search(r"</div>\s*<p\b[^>]*>(.*?)</p>", block, re.I | re.S)
        author = strip_tags(author_match.group(1)) if author_match else ""
        date = strip_tags(date_match.group(1)) if date_match else ""
        body = strip_tags(body_match.group(1)) if body_match else ""
        if body:
            item = {"author": author or "Visitor", "text": body}
            if date:
                item["date"] = date
            comments.append(item)
    return merge_unique([], comments, key="text")


def extract_section_links(text: str, person_id: str, suffix: str) -> list[dict[str, str]]:
    seen: set[str] = set()
    items = []
    for link in extract_links(text):
        path = link["path"]
        if not path.startswith(f"/{person_id}/{suffix}/"):
            continue
        if path in seen or not link["text"]:
            continue
        seen.add(path)
        items.append({"title": link["text"], "url": absolute_url(path)})
    return items


def extract_section_pages(text: str, person_id: str, suffix: str) -> list[str]:
    pages = []
    for link in extract_links(text):
        path = link["path"]
        if re.match(rf"^/{re.escape(person_id)}/{re.escape(suffix)}/page[:-]\d+$", path) and path not in pages:
            pages.append(path)
    return pages


def extract_pages_for_base(text: str, base_path: str) -> list[str]:
    pages = []
    base_path = base_path.rstrip("/")
    for link in extract_links(text):
        path = link["path"]
        if re.match(rf"^{re.escape(base_path)}/page[:-]\d+$", path) and path not in pages:
            pages.append(path)
    return pages


def extract_episode_links(text: str, series_url: str) -> list[dict[str, str]]:
    base_path = local_path(series_url).rstrip("/")
    seen: set[str] = set()
    episodes = []
    entry_re = re.compile(r"<div\b[^>]*\bitemprop=[\"']episode[\"'][^>]*>(.*?)(?=<div\b[^>]*\bitemprop=[\"']episode[\"']|<div\b[^>]*class=[\"'][^\"']*pagination|</div>\s*<div class=\"clear\")", re.I | re.S)
    blocks = entry_re.findall(text) or [text]
    for block in blocks:
        for link in extract_links(block):
            path = link["path"]
            if not path.startswith(base_path + "/") or not path.endswith(".htm"):
                continue
            if path in seen:
                continue
            seen.add(path)
            title = link["text"] or Path(path).stem.replace("-", " ").title()
            thumb = ""
            thumb_match = re.search(rf"<a\b[^>]*href=[\"']{re.escape(path)}[\"'][^>]*>\s*<img\b[^>]*src=[\"']([^\"']+)[\"']", block, re.I | re.S)
            if thumb_match:
                thumb = absolute_url(html.unescape(thumb_match.group(1)))
            duration = ""
            duration_match = re.search(r"<div\b[^>]*class=[\"'][^\"']*\bentry_date\b[^\"']*[\"'][^>]*>.*?<div\b[^>]*class=[\"']day[\"'][^>]*>(.*?)</div>.*?<div\b[^>]*class=[\"']month[\"'][^>]*>(.*?)</div>", block, re.I | re.S)
            if duration_match:
                duration = f"{strip_tags(duration_match.group(1))} {strip_tags(duration_match.group(2))}".strip()
            episodes.append({"title": title, "url": absolute_url(path), "thumb": thumb, "duration": duration})
    return episodes


def extract_attr(tag: str, attr: str) -> str:
    for name, value in ATTR_RE.findall(tag):
        if name.lower() == attr.lower():
            return html.unescape(value).strip()
    return ""


def extract_photos(text: str, person_slug: str) -> list[dict[str, str]]:
    photos = []
    seen = set()
    card_re = re.compile(r"<a\b[^>]*href=[\"']([^\"']*/media/photo/full_size/[^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
    for full, body in card_re.findall(text):
        full_url = absolute_url(html.unescape(full))
        thumb_match = re.search(r"<img\b[^>]*src=[\"']([^\"']*/media/photo/(?:thumbs|[^\"']*)/?.*?)[\"']", body, re.I | re.S)
        thumb_url = absolute_url(html.unescape(thumb_match.group(1))) if thumb_match else full_url.replace("/full_size/", "/thumbs/")
        if full_url not in seen:
            seen.add(full_url)
            photos.append({"full": full_url, "thumb": thumb_url, "title": Path(urllib.parse.urlparse(full_url).path).name})
    for link in extract_links(text):
        full_url = absolute_url(link["path"])
        if "/media/photo/full_size/" in full_url and full_url not in seen:
            seen.add(full_url)
            photos.append({"full": full_url, "thumb": full_url.replace("/full_size/", "/thumbs/"), "title": Path(urllib.parse.urlparse(full_url).path).name})
    return photos


def extract_playlist_tracks(xml_url: str, delay: float, refresh: bool) -> list[dict[str, str]]:
    raw = fetch_text(xml_url, delay=delay, refresh=refresh)
    tracks = []
    for index, block in enumerate(re.findall(r"<track>(.*?)</track>", raw, re.I | re.S), start=1):
        location = re.search(r"<location>(.*?)</location>", block, re.I | re.S)
        if not location:
            continue
        media_url = strip_tags(location.group(1))
        title = re.search(r"<title>(.*?)</title>", block, re.I | re.S)
        creator = re.search(r"<creator>(.*?)</creator>", block, re.I | re.S)
        identifier = re.search(r"<identifier>(.*?)</identifier>", block, re.I | re.S)
        tracks.append(
            {
                "id": strip_tags(identifier.group(1)) if identifier else str(index),
                "title": strip_tags(title.group(1)) if title else Path(urllib.parse.urlparse(media_url).path).stem,
                "creator": strip_tags(creator.group(1)) if creator else "",
                "duration": "",
                "mediaUrl": media_url,
                "source": absolute_url(xml_url),
            }
        )
    return tracks


def extract_direct_audio_tracks(page_url: str, text: str) -> list[dict[str, str]]:
    tracks = []
    link_re = re.compile(r"(<a\b[^>]*href=[\"']([^\"']+\.mp3[^\"']*)[\"'][^>]*>)(.*?)</a>", re.I | re.S)
    for index, match in enumerate(link_re.finditer(text), start=1):
        tag, href, body = match.group(1), html.unescape(match.group(2)), match.group(3)
        title = strip_tags(body) or Path(urllib.parse.urlparse(href).path).stem
        tracks.append(
            {
                "id": extract_attr(tag, "data-rbug") or str(index),
                "title": title,
                "creator": "",
                "duration": extract_attr(tag, "data-duration"),
                "mediaUrl": absolute_url(href),
                "source": absolute_url(page_url),
            }
        )
    return tracks


def extract_recordings_for_item(item: dict[str, str], delay: float, refresh: bool) -> dict[str, str]:
    text = fetch_text(item["url"], delay=delay, refresh=refresh)
    tracks = []
    xml_match = re.search(r"urlXML=([^&\"']+)", text, re.I)
    if xml_match:
        tracks = extract_playlist_tracks(html.unescape(urllib.parse.unquote(xml_match.group(1))), delay=delay, refresh=refresh)
    if not tracks:
        tracks = extract_direct_audio_tracks(item["url"], text)
    item["recordings"] = tracks
    return item


def extract_video_metadata(item: dict[str, str], delay: float, refresh: bool) -> dict[str, str]:
    text = fetch_text(item["url"], delay=delay, refresh=refresh)
    video_source = re.search(r"<video\b([^>]*)>.*?<source\b[^>]*src=[\"']([^\"']+)[\"']", text, re.I | re.S)
    if video_source:
        poster = re.search(r"\bposter=[\"']([^\"']+)[\"']", video_source.group(1), re.I)
        if poster and not item.get("thumb"):
            item["thumb"] = absolute_url(html.unescape(poster.group(1)))
        item["mediaUrl"] = absolute_url(html.unescape(video_source.group(2)))
        item["sources"] = [{"url": item["mediaUrl"], "label": ""}]
        if item.get("thumb"):
            return item

    file_match = re.search(r"\bfile\s*:\s*[\"']([^\"']+)[\"']", text, re.I)
    image_match = re.search(r"\bimage\s*:\s*[\"']([^\"']*)[\"']", text, re.I)
    sources = []
    sources_block = re.search(r"\bsources\s*:\s*\[(.*?)\]", text, re.I | re.S)
    if sources_block:
        for source_block in re.findall(r"\{(.*?)\}", sources_block.group(1), re.I | re.S):
            source_file = re.search(r"\bfile\s*:\s*[\"']([^\"']+)[\"']", source_block, re.I)
            if not source_file:
                continue
            label = re.search(r"\blabel\s*:\s*[\"']([^\"']+)[\"']", source_block, re.I)
            sources.append(
                {
                    "url": absolute_url(html.unescape(source_file.group(1))),
                    "label": strip_tags(label.group(1)) if label else "",
                }
            )
    if file_match:
        file_url = absolute_url(html.unescape(file_match.group(1)))
        item["mediaUrl"] = file_url
        if not sources:
            sources.append({"url": file_url, "label": ""})
    if sources:
        def quality_key(source: dict[str, str]) -> int:
            match = re.search(r"(\d{3,4})p?", source.get("label", "") + " " + source.get("url", ""), re.I)
            return int(match.group(1)) if match else 0

        sources = sorted(merge_unique([], sources, key="url"), key=quality_key, reverse=True)
        item["sources"] = sources
        item["mediaUrl"] = sources[0]["url"]
    if image_match and image_match.group(1):
        item["thumb"] = absolute_url(html.unescape(image_match.group(1)))
    if not item.get("thumb"):
        meta_image = re.search(r"<meta\b[^>]*(?:property|itemprop)=[\"'](?:og:image|image)[\"'][^>]*content=[\"']([^\"']+)[\"']", text, re.I)
        if meta_image:
            item["thumb"] = absolute_url(html.unescape(meta_image.group(1)))
    if not item.get("thumb"):
        thumbnail = re.search(r"<meta\b[^>]*itemprop=[\"']thumbnailUrl[\"'][^>]*content=[\"']([^\"']+)[\"']", text, re.I)
        if thumbnail:
            item["thumb"] = absolute_url(html.unescape(thumbnail.group(1)))
    return item


def extract_video_lessons_for_item(item: dict[str, str], delay: float, refresh: bool) -> dict[str, Any]:
    episodes = []
    texts: list[tuple[str, str]] = []
    for candidate in [item["url"], *page_fallback_urls(item["url"])]:
        try:
            text = fetch_text(candidate, delay=delay, refresh=refresh)
        except urllib.error.URLError as exc:
            print(f"warn: failed video lesson series {candidate}: {exc}")
            continue
        texts.append((candidate, text))
        episodes = merge_unique(episodes, extract_episode_links(text, candidate), key="url")
        if episodes:
            break
    for candidate, text in texts:
        for page in extract_pages_for_base(text, local_path(candidate)):
            try:
                episodes = merge_unique(episodes, extract_episode_links(fetch_text(page, delay=delay, refresh=refresh), candidate), key="url")
            except urllib.error.URLError as exc:
                print(f"warn: failed video lesson page {page}: {exc}")
    for episode in episodes:
        try:
            extract_video_metadata(episode, delay=delay, refresh=refresh)
        except urllib.error.URLError as exc:
            print(f"warn: failed video lesson episode {episode.get('url')}: {exc}")
    item["recordings"] = episodes
    return item


def extract_photo_pages(text: str, person_id: str) -> list[str]:
    pages = []
    for link in extract_links(text):
        path = link["path"]
        if re.match(rf"^/{re.escape(person_id)}/photos/page[:-]\d+$", path) and path not in pages:
            pages.append(path)
    return pages


def extract_ajax_collections(text: str) -> list[dict[str, str]]:
    collections = []
    all_collections = []
    seen = set()
    for link in extract_links(text):
        if "/ajax/loadplayer-" in link["path"] and link["text"]:
            label = link["text"]
            collection_id = link["path"].rstrip("/").split("-")[-1]
            item = {
                "id": collection_id,
                "title": label,
                "riwayah": "",
                "category": "",
                "ajax": absolute_url(link["path"]),
            }
            if label.lower() == "all":
                all_collections.append(item)
                continue
            if label in seen:
                continue
            seen.add(label)
            collections.append(item)
    return collections or all_collections


def extract_collection_headings(text: str) -> list[dict[str, str]]:
    collections = []
    seen = set()
    for heading in [strip_tags(m.group(2)) for m in H_RE.finditer(text)]:
        if not heading or heading.lower().startswith("al-massahef recited"):
            continue
        if heading in seen:
            continue
        seen.add(heading)
        collections.append(
            {
                "id": str(len(collections) + 1),
                "title": heading,
                "riwayah": "",
                "category": "",
                "ajax": "",
            }
        )
    return collections


def normalize_recitations(data: dict[str, Any]) -> list[dict[str, str]]:
    recitations = []
    for row in data.get("Recitation", []):
        rec_id = str(row.get("link_person", "")).rstrip("/").split("-")[-1]
        surah_number = str(row.get("sura_id", "")).strip()
        surah = SURAH_NAMES.get(int(surah_number), str(row.get("span_name", "")).strip()) if surah_number.isdigit() else str(row.get("span_name", "")).strip()
        revelation = str(row.get("class1") or row.get("stats-kind", "")).strip()
        recitations.append(
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
                "playerXml": f"{ORIGIN}/player/onerecitation-{rec_id}.xml" if rec_id else "",
            }
        )
    return recitations


def merge_unique(existing: list[Any], incoming: list[Any], key: str | None = None) -> list[Any]:
    def marker_for(item: Any) -> Any:
        if key and isinstance(item, dict):
            return item.get(key)
        if isinstance(item, (dict, list)):
            return json.dumps(item, sort_keys=True, ensure_ascii=False)
        return item

    result = list(existing)
    seen = set()
    for item in result:
        seen.add(marker_for(item))
    for item in incoming:
        marker = marker_for(item)
        if marker not in seen:
            seen.add(marker)
            result.append(item)
    return result


def crawl_person(profile_path: str, roles: set[str], delay: float, refresh: bool, include_recitations: bool) -> dict[str, Any] | None:
    person_match = PROFILE_RE.match(profile_path)
    if not person_match:
        return None
    person_id = person_match.group(1)
    slug = person_match.group(2)
    try:
        text = fetch_text(profile_path, delay=delay, refresh=refresh)
    except urllib.error.URLError as exc:
        print(f"warn: failed profile {profile_path}: {exc}")
        return None
    profile_variants = fetch_text_variants(profile_path, delay=delay, refresh=refresh)
    if not profile_variants:
        profile_variants = [(profile_path, text)]

    name, arabic = parse_h1(text)
    person: dict[str, Any] = {
        "id": person_id,
        "slug": slug,
        "name": name or slug.replace("-", " ").title(),
        "arabicName": arabic,
        "country": extract_country(text),
        "roles": sorted(roles),
        "profileUrl": absolute_url(profile_path),
        "image": extract_person_image(text, slug),
        "banner": extract_banner(text),
        "bio": extract_bio(text),
        "sameCountry": merge_unique([], [item for _, variant in profile_variants for item in extract_same_country_links(variant)], key="url"),
        "comments": merge_unique([], [item for _, variant in profile_variants for item in extract_comments(variant)], key="text"),
        "tabs": tab_counts(text, person_id),
        "collections": [],
        "recitations": [],
        "albums": [],
        "audioLessons": [],
        "videoLessons": [],
        "photos": [],
        "videos": [],
    }

    if person["tabs"].get("collections") or person["tabs"].get("recitations"):
        person["collections"] = extract_ajax_collections(text)

    if person["tabs"].get("recitations"):
        quran_path = f"/{person_id}/quran"
        for _, quran_text in fetch_text_variants(quran_path, delay=delay, refresh=refresh):
            person["collections"] = merge_unique(person["collections"], extract_ajax_collections(quran_text), key="id")

    if person["tabs"].get("collections"):
        collection_path = f"/{person_id}/collection"
        for _, collection_text in fetch_text_variants(collection_path, delay=delay, refresh=refresh):
            person["collections"] = merge_unique(person["collections"], extract_ajax_collections(collection_text), key="id")
            person["collections"] = merge_unique(person["collections"], extract_collection_headings(collection_text), key="id")

    if include_recitations and person["collections"]:
        recitations = []
        for collection in person["collections"]:
            ajax = collection.get("ajax")
            if not ajax:
                continue
            try:
                recitations = merge_unique(recitations, normalize_recitations(fetch_json(ajax, delay=delay, refresh=refresh)), key="id")
            except (urllib.error.URLError, json.JSONDecodeError) as exc:
                print(f"warn: failed ajax {ajax}: {exc}")
        person["recitations"] = recitations

    if person["tabs"].get("anasheed"):
        for _, album_text in fetch_text_variants(f"/{person_id}/album", delay=delay, refresh=refresh):
            person["albums"] = merge_unique(person["albums"], extract_section_links(album_text, person_id, "album"), key="url")
        for album in person["albums"]:
            try:
                extract_recordings_for_item(album, delay=delay, refresh=refresh)
            except (urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
                print(f"warn: failed album recordings {album.get('url')}: {exc}")

    optional_sections = (
        ("series-audio", "audioLessons", person["tabs"].get("audioLessons") or f"/{person_id}/series-audio" in text),
        ("series", "videoLessons", person["tabs"].get("videoLessons") or f"/{person_id}/series" in text),
        ("videos", "videos", f"/{person_id}/videos" in text),
    )
    for suffix, target, should_fetch in optional_sections:
        if not should_fetch:
            continue
        try:
            section_variants = fetch_text_variants(f"/{person_id}/{suffix}", delay=delay, refresh=refresh)
            section_pages: list[str] = []
            for _, page_text in section_variants:
                person[target] = merge_unique(person[target], extract_section_links(page_text, person_id, suffix), key="url")
                section_pages = merge_unique(section_pages, extract_section_pages(page_text, person_id, suffix))
            for page in section_pages:
                try:
                    for _, page_text in fetch_text_variants(page, delay=delay, refresh=refresh):
                        person[target] = merge_unique(person[target], extract_section_links(page_text, person_id, suffix), key="url")
                except urllib.error.URLError as exc:
                    print(f"warn: failed {suffix} page {page}: {exc}")
            if target == "audioLessons":
                for series in person[target]:
                    try:
                        extract_recordings_for_item(series, delay=delay, refresh=refresh)
                    except (urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
                        print(f"warn: failed audio lesson recordings {series.get('url')}: {exc}")
            if target == "videoLessons":
                for series in person[target]:
                    try:
                        extract_video_lessons_for_item(series, delay=delay, refresh=refresh)
                    except (urllib.error.URLError, json.JSONDecodeError, ValueError) as exc:
                        print(f"warn: failed video lesson recordings {series.get('url')}: {exc}")
            if target == "videos":
                for video in person[target]:
                    try:
                        extract_video_metadata(video, delay=delay, refresh=refresh)
                    except urllib.error.URLError as exc:
                        print(f"warn: failed video metadata {video.get('url')}: {exc}")
        except urllib.error.HTTPError as exc:
            if exc.code != 404:
                print(f"warn: failed {suffix} {person_id}: {exc}")
        except urllib.error.URLError as exc:
            print(f"warn: failed {suffix} {person_id}: {exc}")

    if person["tabs"].get("photos"):
        try:
            photos = []
            photo_pages: list[str] = []
            for _, first_photo_text in fetch_text_variants(f"/{person_id}/photos", delay=delay, refresh=refresh):
                photos = merge_unique(photos, extract_photos(first_photo_text, slug), key="full")
                photo_pages = merge_unique(photo_pages, extract_photo_pages(first_photo_text, person_id))
            for page in photo_pages:
                try:
                    for _, page_text in fetch_text_variants(page, delay=delay, refresh=refresh):
                        photos = merge_unique(photos, extract_photos(page_text, slug), key="full")
                except urllib.error.URLError as exc:
                    print(f"warn: failed photo page {page}: {exc}")
            person["photos"] = photos
        except urllib.error.URLError as exc:
            print(f"warn: failed photos {person_id}: {exc}")

    return person


def write_catalog(people: list[dict[str, Any]], partial: bool) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    catalog = {
        "source": ORIGIN,
        "sync": {
            "mode": "partial" if partial else "full",
            "people": len(people),
            "mediaPolicy": "metadata-only; audio and photo bytes are downloaded only through /api/download",
            "ajaxFallbackOrigins": list(FALLBACK_ORIGINS),
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "people": people,
    }
    tmp_path = CATALOG_PATH.with_suffix(".json.tmp")
    text = json.dumps(catalog, ensure_ascii=False, indent=2)
    last_error: OSError | None = None
    for attempt in range(5):
        try:
            tmp_path.write_text(text, encoding="utf-8")
            os.replace(tmp_path, CATALOG_PATH)
            return
        except OSError as exc:
            last_error = exc
            time.sleep(0.25 * (attempt + 1))
    if last_error:
        raise last_error


def load_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def enrich_profile_metadata(delay: float, refresh: bool, max_profiles: int = 0) -> None:
    catalog = load_catalog()
    people = catalog.get("people", [])
    total = len(people)
    limit = min(total, max_profiles or total)
    for index, person in enumerate(people, start=1):
        if max_profiles and index > max_profiles:
            break
        profile_url = person.get("profileUrl")
        slug = person.get("slug", "")
        if not profile_url:
            continue
        try:
            text = fetch_text(profile_url, delay=delay, refresh=refresh)
        except urllib.error.URLError as exc:
            print(f"warn: failed profile metadata {profile_url}: {exc}")
            continue
        person["image"] = extract_person_image(text, slug) or person.get("image", "")
        person["banner"] = extract_banner(text)
        person["bio"] = extract_bio(text)
        person["sameCountry"] = extract_same_country_links(text)
        person["comments"] = extract_comments(text)
        if index % 25 == 0:
            write_catalog(people, partial=True)
            print(f"metadata checkpoint {index}/{limit}")
    write_catalog(people, partial=bool(max_profiles))
    print(f"done: enriched profile metadata for {limit} profiles")


def main() -> None:
    parser = argparse.ArgumentParser(description="Mirror Assabile catalogue metadata without downloading media files.")
    parser.add_argument("--delay", type=float, default=0.15, help="Delay between uncached network requests.")
    parser.add_argument("--refresh", action="store_true", help="Refetch cached HTML/JSON pages.")
    parser.add_argument("--max-profiles", type=int, default=0, help="Limit profiles for a test sync.")
    parser.add_argument("--max-list-pages", type=int, default=0, help="Limit listing pages per section for a test sync.")
    parser.add_argument("--skip-recitations", action="store_true", help="Skip collection AJAX recitation metadata.")
    parser.add_argument("--enrich-profile-metadata", action="store_true", help="Refresh profile bio/banner/comments fields in the existing catalogue.")
    args = parser.parse_args()

    if args.enrich_profile_metadata:
        enrich_profile_metadata(args.delay, args.refresh, args.max_profiles)
        return

    discovered: dict[str, dict[str, Any]] = {}
    sections = {"quran": "reciter", "lesson": "preacher", "anasheed": "munshid"}
    for section, role in sections.items():
        for person_id, path in crawl_listing(section, args.delay, args.refresh, args.max_list_pages or None).items():
            discovered.setdefault(person_id, {"path": path, "roles": set()})
            discovered[person_id]["roles"].add(role)

    people = []
    total = len(discovered)
    for index, item in enumerate(discovered.values(), start=1):
        if args.max_profiles and index > args.max_profiles:
            break
        print(f"profile {index}/{total}: {item['path']}")
        person = crawl_person(item["path"], item["roles"], args.delay, args.refresh, not args.skip_recitations)
        if person:
            people.append(person)
            if index % 25 == 0:
                write_catalog(people, partial=True)
                print(f"checkpoint: wrote {len(people)} people")

    people.sort(key=lambda p: (p.get("roles", [""])[0], p.get("name", "")))
    write_catalog(people, partial=bool(args.max_profiles))
    print(f"done: wrote {len(people)} people to {CATALOG_PATH}")


if __name__ == "__main__":
    main()
