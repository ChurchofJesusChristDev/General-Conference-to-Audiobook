# General Conference to Audiobook

Download General Conference talks from ChurchofJesusChrist.org and organize them for audiobook apps, Plex, or Jellyfin.

The project has exactly two libraries and three entrypoints:

| Path | Purpose |
|---|---|
| `lib/general-conference-metadata.mjs` | Site-specific page, state, player, artwork, and subtitle parsing |
| `lib/general-conference-downloader.mjs` | Generic media and local sidecar operations |
| `general-conference-browser.js` | Paste into a conference page; downloads TSV, POSIX sh, and PowerShell files |
| `update-general-conference.mjs` | Local metadata updater and resumable TSV writer |
| `download-general-conference.mjs` | Local media downloader, naming, and sidecar orchestration |

Old one-off crawlers, exporters, artwork scripts, and sidecar helpers are no longer supported.

## Requirements

- Node.js 20 or newer
- `ffprobe` only when using `--ffprobe` to validate local media
- A project-local environment file based on [`example.env`](./example.env)

## Browser workflow

1. Open a General Conference season page.
2. Open the browser developer console.
3. Paste [`general-conference-browser.js`](./general-conference-browser.js).
4. The script reads the current page, fetches same-origin talk pages with six concurrent requests, and adds a banner with download links for:
   - `general-conference.tsv`
   - `general-conference.sh`
   - `general-conference.ps1`

The TSV is suitable for the local downloader after its fields are mapped to the local manifest. The generated shell scripts use the direct audio URLs.

## Local workflow

Update metadata and media URLs. By default the range is the most recent four conferences. The newest conference becomes available three days after the first Sunday of its month; use `--refresh` to fetch existing rows again.

```sh
node update-general-conference.mjs --refresh
```

Set metadata page concurrency with `--concurrency 20` (default) or the `CONFERENCE_CONCURRENCY` environment variable.

Refresh all conferences back to April 1971:

```sh
node update-general-conference.mjs --all --refresh
```

The updater discovers page state, audio/video sources, artwork, and English subtitle URLs. It writes resumable `talks.tsv` and `cache/media-links.tsv` catalogs.

Download the default four-conference range, newest first. `GENERAL_CONFERENCE_SHOWS_PATH` is the parent of the Shows root. If podcast values are omitted, the show name and path are reused. Use `--shows-dir` or `--podcast-dir` to override either root.

```sh
node download-general-conference.mjs \
  --env ./example.env \
  --media ./cache/media-links.tsv \
  --podcast-dir "$HOME/Podcasts/General Conference"
```

The default downloads talks only, with both video and audio. Use `--primary talks|sessions` to choose the primary record type. Use `--archive` to download both talks and sessions. Use `--all` to select every available conference back to `1971-04`. Use `--audio-only` or `--video-only` to select one media type. Use `--no-podcasts` to disable the configured Podcasts root. `--audio-only` requires Podcasts. Sessions use `SYYYYMME1nn`; talks use `SYYYYMMEnn`. Non-primary records go under `Others/`.

Downloads use visible `.part` files, resume with HTTP range requests, and publish atomically. Completed files are trusted by default; use `--ffprobe` to validate existing and completed media. Markdown sidecars use Defuddle and are fetched only when missing. Show match files are generated only after a successful video download. Audio goes under `Podcasts`; video and its sidecars go under `Shows`.

Configuration:

```sh
export GENERAL_CONFERENCE_SHOW_NAME="General Conference"
export GENERAL_CONFERENCE_SHOWS_PATH="$HOME/Videos/"
export GENERAL_CONFERENCE_PODCAST_NAME="General Conference"
export GENERAL_CONFERENCE_PODCASTS_PATH="$HOME/Podcasts/"
export GENERAL_CONFERENCE_VIDEO_QUALITY="720p"
export GENERAL_CONFERENCE_AUDIO_FORMAT="m4a"
export GENERAL_CONFERENCE_BRIGHTCOVE_POLICY_KEY=""
```

## Output layout

```text
Shows root/
  tvshow.nfo
  .plexmatch
  Season 202604/
    poster.jpg
    season.nfo
    .plexmatch
    General Conference - S202604E01 - Talk Title/
      General Conference - S202604E01 - Talk Title - 720p.mp4
      General Conference - S202604E01 - Talk Title.md
      General Conference - S202604E01 - Talk Title.vtt
      episode.nfo
      .plexmatch
      poster.jpg
    Others/
      General Conference - S202604O01 - Saturday Morning Session/
        General Conference - S202604O01 - Saturday Morning Session - 720p.mp4

Podcasts root/
  Season 202604/
    General Conference - S202604E01 - Talk Title/
      General Conference - S202604E01 - Talk Title.mp3
```

## Audiobook conversion

Add one season's audio files to AudioBookBinder and export an `.m4b`, or use the generated Plex/Jellyfin sidecars to keep talks as separate episodes.

## Other resources

- [Pre-converted October 2023 audiobook](https://github.com/ChurchofJesusChristDev/General-Conference-to-Audiobook/raw/main/October%202023%20General%20Conference.m4b)
- [LibriVox Book of Mormon](https://librivox.org/the-book-of-mormon-by-joseph-smith-jr/)
- [Church publications and audio](https://www.churchofjesuschrist.org/media/publications?lang=eng)
