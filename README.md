# General Conference to Audiobook

Download General Conference talks from ChurchofJesusChrist.org and organize them
for audiobook apps, Plex, or Jellyfin.

The old browser-console downloader is retired. The current workflow extracts
metadata and media links from the site's encoded page state, then downloads
selected seasons with resumable files.

## Requirements

- Node.js 20 or newer
- `curl`
- `ffmpeg` and `ffprobe`
- A project-local environment file based on [`example.env`](./example.env)

Set these values in the environment file:

```sh
export GENERAL_CONFERENCE_DOWNLOAD_PATH="$HOME/Videos/General Conference"
export GENERAL_CONFERENCE_VIDEO_QUALITY="720p"
# Audio output is MP3 only; non-MP3 sources are skipped.
export GENERAL_CONFERENCE_AUDIO_FORMAT="mp3"
```

The Brightcove policy key is only needed for subtitle extraction:

```sh
export GENERAL_CONFERENCE_BRIGHTCOVE_POLICY_KEY="..."
```

Do not commit a real environment file or secret values.

## Build the catalogs

Crawl the conference indexes and save resumable TSV checkpoints:

```sh
node crawl-general-conference-tsv.mjs \
  'https://www.churchofjesuschrist.org/study/general-conference?lang=eng' \
  ./data/all
```

Export the stable talk catalog:

```sh
node export-talks-tsv.mjs ./data/all/metadata.tsv ./data/all/urls.tsv ./talks.tsv
```

`talks.tsv`, `presidents.tsv`, and `conferences.tsv` are stable catalogs.
Generated media URLs belong in `data/`, not in the permanent talk catalog.

## Extract media

For one conference page, use the no-browser extractor:

```sh
node extract-media-links-cli.mjs \
  'https://www.churchofjesuschrist.org/study/general-conference/2025/04?lang=eng' \
  ./data/media-links.json
```

The extractor can be rerun. It writes a checkpoint after each successful page.
The CDP extractor, `extract-media-links.mjs`, is available when browser-rendered
controls are needed and expects Brave Beta's CDP endpoint on localhost.

For the catalog workflow, refresh links for a period range with:

```sh
node crawl-media-links-tsv.mjs ./talks.tsv ./data/media-links.tsv false 1971-04 2026-04
```

## Download and create sidecars

Download one season, a range, or the next incomplete seasons:

```sh
node download-conference-seasons.mjs \
  --env ./example.env \
  --talks ./data/all/metadata.tsv \
  --media ./data/media-links.tsv \
  --start 2025-04 \
  --end 2025-04

node download-conference-seasons.mjs \
  --env ./example.env \
  --talks ./data/all/metadata.tsv \
  --media ./data/media-links.tsv \
  --next 1
```

Downloads use visible `.part` files and are published only after `ffprobe`
validation. A `download.complete` marker is written only when the selected
season finishes successfully. The downloader runs the sidecar generator after
the media pass.

Sidecars include:

- `tvshow.nfo`, season and episode NFO files
- `.plexmatch` files
- Markdown talk text
- WebVTT subtitles
- Episode and season artwork

The supporting tools are:

```sh
node add-subtitle-links.mjs ./data/media-links.json
node download-subtitles.mjs ./data/media-links.json ./data/subtitles
node defuddle-conference-text.mjs ./data/media-links.json ./data/text
node download-artwork.mjs ./data/media-links.json ./data/artwork
node generate-conference-sidecars.mjs ./example.env ./data/all/metadata.tsv
```

Run the compatibility matrix against 1971-04, 2000-04, 2025-04, and 2026-04
before a full crawl. Keep generated downloads and credentials outside the Git
commit unless they are explicitly intended as release artifacts.

## Download pre-converted files

- [October 2023 General Conference.m4b](https://github.com/ChurchofJesusChristDev/General-Conference-as-Audiobook/raw/main/October%202023%20General%20Conference.m4b)

## Other resources

- [LibriVox Book of Mormon](https://librivox.org/the-book-of-mormon-by-joseph-smith-jr/)
- [Church publications and audio](https://www.churchofjesuschrist.org/media/publications?lang=eng)
