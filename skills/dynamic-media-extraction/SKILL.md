---
name: dynamic-media-extraction
description: Discover and collect dynamically generated audio, video, subtitle, and text links from modern web pages. Use when media URLs are missing from initial HTML and may be exposed through encoded state, client-side players, or browser controls.
compatibility: Requires Node.js. Use Brave CDP when runtime inspection is needed.
---

# Dynamic Media Extraction

Use this workflow to turn a dynamic content site into a local, resumable media manifest.

## Index structure

Use this reference when labeling conference ranges by Church presidency:

<https://newsroom.churchofjesuschrist.org/article/church-presidents>

General Conference-style sites commonly expose multiple indexes:

1. **Conference date:** `Decade → Conference season → Session → Talk`
2. **Speaker:** `Speaker → Talks → Talk`
3. **Topic:** `Topic → Talks → Talk`

Use the date index as the canonical media hierarchy. Treat speaker and topic
indexes as lookup metadata; do not duplicate media for those alternate paths.

For media-server organization:

```text
General Conference/
  Season 198204/
    General Conference - S8204E01 - Talk Title.mp3
```

## Process

1. **Inspect the raw HTML first**
   - Fetch the page with Node.js or `curl`.
   - Record the title, canonical URL, content links, metadata, and media-looking attributes.
   - Search for audio/video/source/track elements and download URLs.

2. **Look for initial state**
   - Search scripts for names such as `INITIAL_STATE`, `PRELOADED_STATE`, or app configuration.
   - Check whether the value is base64, escaped JSON, compressed, or otherwise encoded.
   - Decode it with Node.js.
   - Inspect content stores, page metadata, media arrays, source elements, asset IDs, reference IDs, and text-track data.

3. **Try a command-line path**
   - If the initial state contains final media URLs, use Node.js `fetch` directly.
   - Extract title, speaker, description, page ID, media IDs, audio URLs, video URLs, stream URLs, and subtitle metadata.
   - Prefer a no-browser extractor when the state is sufficient.

4. **Use Brave CDP when needed**
   - Start an isolated Brave Beta profile with CDP bound to localhost.
   - Navigate to the page and wait for client rendering.
   - Enable the CDP Network domain before interacting.
   - Capture request and response URLs, headers, status, MIME types, and relevant response bodies.
   - Do not expose the CDP port outside localhost.

5. **Inspect visible media controls**
   - Find audio/headphones controls and open the audio widget.
   - Look for More, Options, Download, Download Audio, or This Page links.
   - Find the main video play control and start it if needed to initialize video metadata.
   - Open video download controls and collect every available quality.
   - Check subtitle/caption settings and text-track links.

6. **Map player requests**
   - Identify player metadata requests and public playback API calls.
   - Capture policy or request headers only when needed to reproduce a public request.
   - Inspect playback JSON for `sources`, `download_links`, `text_tracks`, `reference_id`, and media IDs.
   - Do not guess opaque IDs from episode numbers. Derive them from page state or player metadata.

7. **Extract readable text**
   - Use Defuddle or Readability for the page text.
   - Save Markdown in separate sidecar files.
   - Keep text out of the media manifest when the manifest is meant to stay tabular.

8. **Save subtitles**
   - Download WebVTT caption files when available.
   - Save them as separate sidecar files.
   - Record the local file name and source URL in the manifest.

9. **Use deterministic sidecar names**
   - Base names on the episode or content number.
   - Example: `data/text/1-01.md` and `data/subtitles/1-01.en.vtt`.
   - Keep session recordings and individual talks distinct.

10. **Make extraction resumable**
    - Write the manifest after every successful page.
    - Skip URLs already present in the manifest.
    - Continue past one-page failures and report them.
    - Process pages in increasing batches such as 1, 2, 4, 8, and so on.
    - Use TSV as the operational media manifest. JSON is only an import or
      recovery format when a one-off merge is needed.
    - Upsert subtitle, season-artwork, and episode-artwork URLs into the TSV;
      do not require a legacy JSON file during normal downloads.

## Download destination and atomic files

Load configuration from a project-local environment file. Use
`example.env` as the template; do not put real machine paths or instance-specific
environment filenames in this general skill.

Required values:

- `GENERAL_CONFERENCE_DOWNLOAD_PATH`: local root for season media and
  sidecars. The default is `~/Videos/General Conference`; expand `~` using
  the current user's home directory, not as a literal folder name.
- `GENERAL_CONFERENCE_VIDEO_QUALITY`: preferred video quality, such as
  `720p`.
- `GENERAL_CONFERENCE_AUDIO_FORMAT`: preferred output format, such as `m4a`.

Optional values:

- `GENERAL_CONFERENCE_BRIGHTCOVE_POLICY_KEY`: the site's public player policy
  key, used to discover caption tracks. It is not a user credential.
- `DEFUDDLE_FETCHER`: path to the Defuddle fetch helper used for Markdown.

The configuration should provide:

- preferred video quality
- preferred audio format
- download root

Fallbacks are rules, not configuration. For video, try the requested quality,
then the next quality up, then the next quality down, then any remaining
available quality. For audio, try the requested format, then the closest available source
format. Never transcode media. For example, `m4a` uses a direct M4A URL when
available, otherwise downloads the site's MP3 unchanged. If neither MP3 nor
M4A exists, extract the audio stream from a downloaded video with stream copy
only, preserving its codec, and place it in the correct container for that
codec. Download only the selected representation; do not fetch all variants by
default.

Use the configured root as the base for season folders. Resumable downloads must be atomic:

- Download to a visible sibling file ending in `.part`.
- Resume an existing `.part` file when the server supports range requests.
- Verify the completed file before publishing it.
- Rename the `.part` file to its final name only after success.
- Never use hidden temporary files.
- Never treat a `.part` file as media for Plex or Jellyfin.

Download tools should support:

- an explicit start and end season
- a start season plus a season count
- `next N`, meaning the next N seasons without a completion marker
- resumable reruns that skip completed final files

Write a non-hidden completion marker only after every selected file succeeds.

After each episode's media download, fetch its available WebVTT and JPEG
artwork, then generate that episode's sidecars. Generate `tvshow.nfo`, show
`.plexmatch`, season `season.nfo`, season `.plexmatch`, and season artwork once
per applicable show/season, not once per episode. Generate episode `.nfo`,
episode `.plexmatch`, Markdown, WebVTT, and episode artwork only after at least
one video file for that episode is complete. Sidecar generation must be safe to
rerun and must log the episode once, followed by indented file statuses such as
`OK`, `updated`, `missing`, or `unavailable`.

## Media-server organization

When the extracted media will be used by Jellyfin, Plex, or a similar server,
use this layout:

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
      General Conference - S202604E01 - Introduction.md
      General Conference - S202604E01 - Introduction.vtt
      General Conference - S202604E01 - Introduction.jpg
```

Rules:

- Treat each conference period as a season, using a sortable key such as
  `Season 202604` for April 2026 and `Season 202510` for October 2025.
- Use individual talks as episodes when episode-level playback is wanted.
- Keep full-session recordings distinct from individual talks; do not silently
  create duplicate episodes.
- Use deterministic episode numbers and names, such as
  `General Conference - S202604E01 - Introduction`.
- Map the source Talk Title directly to the media-server episode `<title>` and
  episode filename title. Do not replace it with the speaker, session name, or
  a generated label.
- Generate `tvshow.nfo` and `.plexmatch` at the series level.
- Generate `season.nfo`, `.plexmatch`, and `poster.jpg` inside each season.
- Put each talk in its own folder so it can contain episode-level sidecars.
- Generate `episode.nfo` and `.plexmatch` inside each talk folder.
- Save episode artwork beside the media file using the exact episode stem and
  `.jpg` extension.
- Keep Markdown and WebVTT files as separate sidecars using the exact episode
  stem, such as `General Conference - S202604E01 - Introduction.md` and
  `General Conference - S202604E01 - Introduction.vtt`.

## Permanent talk catalog

Keep a committed `talks.tsv` as the durable catalog. It should contain one row
per talk from the earliest supported conference through the current complete
season. Keep only stable fields:

- period
- decade
- title
- speaker
- description
- canonical talk page URL

Do not put opaque CDN media URLs, playback IDs, asset IDs, or temporary stream
URLs in `talks.tsv`. Those belong in generated download manifests and can be
refreshed from the current site. Rebuild the catalog with
`export-talks-tsv.mjs` after adding newer conference pages.

Keep `presidents.tsv` as the stable president/death catalog and
`conferences.tsv` as the period-to-president lookup. Do not replace those
stable catalogs with opaque media IDs or CDN URLs.

## Manifest guidance

JSON is useful as the canonical manifest while the schema is being discovered. A flattened TSV can be generated later with columns for:

- episode number
- title
- speaker
- description
- page URL
- audio URL
- video URLs by quality
- subtitle URL
- media IDs

Keep Markdown and WebVTT contents in sidecar files. Store only their deterministic file names in TSV or JSON.

## Compatibility test matrix

Every new extractor or sidecar tool must be tested against all of these pages,
not only the newest conference:

```text
https://www.churchofjesuschrist.org/study/general-conference/1971/04?lang=eng
https://www.churchofjesuschrist.org/study/general-conference/2000/04?lang=eng
https://www.churchofjesuschrist.org/study/general-conference/2025/04?lang=eng
https://www.churchofjesuschrist.org/study/general-conference/2026/04?lang=eng
```

The matrix must cover old, middle, recent, and current content. Verify page
indexing, encoded-state decoding, metadata, audio URLs, video URLs, subtitles,
artwork, Markdown text, and sidecar naming for each sample. Keep each run
resumable and preserve its TSV checkpoint.

## Checks

- Compare the number of discovered content pages with the expected page count.
- Verify every page has title metadata.
- Verify audio and video links have the expected file type or MIME type.
- Verify subtitle files begin with `WEBVTT`.
- Confirm session records are not confused with individual talk records.
- Test one audio URL, one video URL, one subtitle URL, and one Markdown sidecar before running the full batch.

## Common failures

- **No media in `curl` output:** client-side state or player controls are supplying it; inspect encoded state, then use CDP.
- **No links before clicking controls:** initialize the audio/video player and open its download menu.
- **Video links missing:** click the main video play control before inspecting the DOM.
- **Playback API returns 401:** reproduce the browser's public policy/header request or use CDP to capture the response.
- **Duplicate pages:** normalize URLs by removing fragments and applying one language query.
- **Huge output:** keep command output bounded and write detailed results to files.
