from __future__ import annotations

import json
import os
import time
import urllib.error
from pathlib import Path

from sync_catalog import (
    CATALOG_PATH,
    extract_photo_pages,
    extract_photos,
    extract_recordings_for_item,
    extract_video_metadata,
    fetch_text,
    merge_unique,
)


def main() -> None:
    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    people = catalog.get("people", [])
    album_tracks = 0
    lesson_tracks = 0
    videos_with_media = 0
    photos = 0

    for index, person in enumerate(people, start=1):
        person_id = person.get("id", "")
        slug = person.get("slug", "")
        print(f"media {index}/{len(people)}: {person_id}")

        for album in person.get("albums", []):
            try:
                extract_recordings_for_item(album, delay=0, refresh=False)
            except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
                print(f"warn: album recordings {album.get('url')}: {exc}")
            album_tracks += len(album.get("recordings", []))

        for series in person.get("audioLessons", []):
            try:
                extract_recordings_for_item(series, delay=0, refresh=False)
            except (urllib.error.URLError, ValueError, json.JSONDecodeError) as exc:
                print(f"warn: audio recordings {series.get('url')}: {exc}")
            lesson_tracks += len(series.get("recordings", []))

        for video in person.get("videos", []):
            try:
                extract_video_metadata(video, delay=0, refresh=False)
            except urllib.error.URLError as exc:
                print(f"warn: video metadata {video.get('url')}: {exc}")
            if video.get("mediaUrl"):
                videos_with_media += 1

        if person.get("photos") and person_id and slug:
            try:
                first = fetch_text(f"/{person_id}/photos", delay=0, refresh=False)
                person_photos = extract_photos(first, slug)
                for page in extract_photo_pages(first, person_id):
                    person_photos = merge_unique(person_photos, extract_photos(fetch_text(page, delay=0, refresh=False), slug), key="full")
                person["photos"] = person_photos
            except urllib.error.URLError as exc:
                print(f"warn: photos {person_id}: {exc}")
        photos += len(person.get("photos", []))

    catalog.setdefault("sync", {})["mediaEnrichedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    catalog["sync"]["mediaEnrichment"] = {
        "albumTracks": album_tracks,
        "audioLessonTracks": lesson_tracks,
        "videosWithMedia": videos_with_media,
        "photos": photos,
        "mediaPolicy": "metadata-only; audio, video, and full photo bytes are cached only when clicked",
    }

    tmp = CATALOG_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, CATALOG_PATH)
    print(json.dumps(catalog["sync"]["mediaEnrichment"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
