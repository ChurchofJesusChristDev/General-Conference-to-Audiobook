# General Conference to Audiobook

Download General Conference talks from ChurchofJesusChrist.org and organize
them for audiobook apps, Plex, or Jellyfin.

The workflow uses TSV catalogs and cache files. `conferences.tsv` is permanent
catalog data. `./cache/` contains resumable metadata and media-link checkpoints.
No JSON files are used.

## Requirements

- Node.js 20 or newer
- `curl`
- `ffmpeg` and `ffprobe`
- A project-local environment file based on [`example.env`](./example.env)

```sh
export GENERAL_CONFERENCE_DOWNLOAD_PATH="$HOME/Videos/General Conference"
export GENERAL_CONFERENCE_VIDEO_QUALITY="720p"
export GENERAL_CONFERENCE_AUDIO_FORMAT="m4a"
```

## Build TSV catalogs

Crawl conference indexes into resumable cache TSVs:

```sh
node crawl-general-conference-tsv.mjs \
  'https://www.churchofjesuschrist.org/study/general-conference?lang=eng' \
  ./cache/all
```

Export the permanent talk catalog:

```sh
node export-talks-tsv.mjs \
  ./cache/all/metadata.tsv ./cache/all/urls.tsv ./talks.tsv
```

Refresh media links:

```sh
node crawl-media-links-tsv.mjs \
  ./talks.tsv ./cache/media-links.tsv false 1971-04 2026-04
```

Update season poster URLs from the main and decade index pages:

```sh
node update-season-artwork-tsv.mjs \
  ./cache/media-links.tsv ./conferences.tsv
```

This updates `poster_url` in the permanent `conferences.tsv` catalog and
`season_artwork_url` in the keyed media-link TSV.

## Download media and sidecars

```sh
node download-conference-seasons.mjs \
  --env ./example.env \
  --talks ./talks.tsv \
  --media ./cache/media-links.tsv \
  --start 2025-04 \
  --end 2025-04
```

With no range, the downloader starts at the latest non-future conference and
ends at `1971-04`. Use `--next N` for the next incomplete seasons.

Downloads are atomic and resumable. M4A is preferred when available, with MP3
fallback. If no audio URL exists, audio is extracted from the downloaded video
with stream copy only. Episode WebVTT, artwork, Markdown, NFO, and Plex/Jellyfin
sidecars are created in the episode folder after media succeeds.

## Plex/Jellyfin layout

```text
General Conference/
  tvshow.nfo
  .plexmatch
  poster.jpg
  Season 202604/
    season.nfo
    .plexmatch
    poster.jpg
    General Conference - S202604E01 - Introduction/
      General Conference - S202604E01 - Introduction.m4a
      General Conference - S202604E01 - Introduction - 720p.mp4
      episode.nfo
      .plexmatch
      poster.jpg
      General Conference - S202604E01 - Introduction.md
      General Conference - S202604E01 - Introduction.vtt
```

## Convert to an audiobook

1. Open **AudioBookBinder** from the App Store.
2. Add one season's talk audio files in episode order.
3. Add the season artwork and export an `.m4b` audiobook.
4. Load it into Bound, Apple Books, or another audiobook app.

The generated Plex/Jellyfin sidecars can be used instead when each talk should
remain a separate episode.

## Download pre-converted files

- [October 2023 General Conference.m4b](https://github.com/ChurchofJesusChristDev/General-Conference-to-Audiobook/raw/main/October%202023%20General%20Conference.m4b)

## Other resources

- [LibriVox Book of Mormon](https://librivox.org/the-book-of-mormon-by-joseph-smith-jr/)
- [Church publications and audio](https://www.churchofjesuschrist.org/media/publications?lang=eng)
