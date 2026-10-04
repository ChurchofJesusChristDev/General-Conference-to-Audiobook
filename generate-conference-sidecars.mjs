#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const envPath = process.argv[2] ?? "./oneal.env";
const metadataPath = process.argv[3] ?? "./data/all/metadata.tsv";
const firstPeriod = process.argv[4] ?? "1971-04";
const lastPeriod = process.argv[5] ?? "9999-10";
const mediaLinksPath = process.argv[6] ?? "./data/media-links.tsv";
const targetPageURL = process.argv[7] ?? "";
const env = parseEnv(await readFile(envPath, "utf8"));
const root = expandHome(env.GENERAL_CONFERENCE_DOWNLOAD_PATH);
const policyKey = env.GENERAL_CONFERENCE_BRIGHTCOVE_POLICY_KEY;
const defuddleFetcher = env.DEFUDDLE_FETCHER ?? "/Users/aj/Skills/pi-skills/defuddle-web-fetch/fetch.js";
if (!root) throw new Error("GENERAL_CONFERENCE_DOWNLOAD_PATH is required");

function expandHome(path) {
  return path?.startsWith("~/") ? `${process.env.HOME}/${path.slice(2)}` : path;
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^export\s+([A-Z0-9_]+)=['\"](.*)['\"]\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}
function parseTSV(text) {
  const lines = text.trimEnd().split("\n");
  const headers = lines.shift().split("\t");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((value, i) => [headers[i], value])));
}
function safeName(value) { return value.replace(/[/:*?"<>|\\]+/g, "-").replace(/\s+/g, " ").trim(); }
function sidecarStatus(action) {
  if (action === "checked" || action === "copied") return "OK (exists and is up-to-date)";
  if (action === "generated" || action === "downloaded") return "updated";
  return action;
}
function sidecarLog(label, name, action) {
  console.log(`${label}: ${name}${action ? ` ${sidecarStatus(action)}` : ""}`);
}
function xml(value) { return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function folderCode(period) { return period.replace("-", ""); }
function seasonCode(period) { return period.replace("-", ""); }
function pageID(url) { return new URL(url).pathname.split("/").pop(); }
async function writeIfChanged(path, content) {
  try {
    if ((await readFile(path, "utf8")) === content) return "checked";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(path, content);
  return "generated";
}
async function fetchHTML(url) {
  const response = await fetch(url, { headers: { "user-agent": "General-Conference-to-Audiobook/1.0" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
function initialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__="([^"]+)"/);
  if (!match) throw new Error("initial state not found");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}
const pageCache = new Map();
async function pageMedia(url) {
  if (!pageCache.has(url)) {
    const state = initialState(await fetchHTML(url));
    const page = Object.values(state.reader?.contentStore ?? {})[0];
    const body = page?.content?.body ?? "";
    const video = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
    pageCache.set(url, {
      poster: video.match(/poster="([^"]+)"/i)?.[1] ?? "",
      videoID: video.match(/data-video-id="([^"]+)"/i)?.[1] ?? "",
      seasonPoster: page?.meta?.ogTagImageUrl ?? "",
    });
  }
  return pageCache.get(url);
}
async function fetchMarkdown(url, title) {
  const result = await execFileAsync("node", [defuddleFetcher, "--timeout", "30", url], { maxBuffer: 1024 * 1024 * 8 });
  const heading = `# ${title}`;
  const index = result.stdout.lastIndexOf(heading);
  return `${(index >= 0 ? result.stdout.slice(index) : result.stdout).trim()}\n`;
}
async function fetchSubtitle(videoID) {
  if (!policyKey || !videoID) return "";
  const response = await fetch(`https://edge.api.brightcove.com/playback/v1/accounts/1241706627001/videos/${videoID}`, { headers: { accept: `application/json;pk=${policyKey}` } });
  if (!response.ok) throw new Error(`Brightcove ${response.status}`);
  const playback = await response.json();
  const track = (playback.text_tracks ?? []).find((item) => item.kind === "captions" && item.srclang === "en");
  if (!track) return "";
  const source = track.sources?.[0]?.src ?? track.src;
  const vtt = await fetch(source.replace(/^http:/, "https:"));
  if (!vtt.ok) throw new Error(`VTT ${vtt.status}`);
  return `${await vtt.text()}\n`;
}
const mediaFile = /\.(?:mp3|m4a|mp4|mka|mkv|ogg|oga|opus|flac|wav|webm)$/i;
async function hasMedia(directory) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isFile() && mediaFile.test(entry.name)) return true;
      if (entry.isDirectory() && await hasMedia(path)) return true;
    }
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function copyIfPresent(source, target) {
  try {
    const sourceInfo = await stat(source);
    try {
      const targetInfo = await stat(target);
      if (targetInfo.size === sourceInfo.size) return "checked";
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await copyFile(source, target);
    return "copied";
  } catch (error) {
    if (error.code === "ENOENT") return "missing";
    throw error;
  }
}
async function ensureFetched(source, target, fetcher) {
  const copied = await copyIfPresent(source, target);
  if (copied !== "missing") return copied;
  try {
    const content = await fetcher();
    if (!content) return "unavailable";
    await writeFile(target, content);
    return "downloaded";
  } catch (error) {
    console.warn(`sidecar fetch failed ${target}: ${error.message}`);
    return "unavailable";
  }
}
async function fetchBinary(url) {
  if (!url) return "";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function fetchText(url) {
  if (!url) return "";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const metadata = parseTSV(await readFile(metadataPath, "utf8"));
const selectedMetadata = targetPageURL ? metadata.filter((record) => record.page_url === targetPageURL) : metadata;
let mediaLinks = [];
try { mediaLinks = parseTSV(await readFile(mediaLinksPath, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const mediaByURL = new Map(mediaLinks.map((row) => [row.page_url, row]));
const episodes = new Map();
const periods = new Set(selectedMetadata.filter((record) => record.period >= firstPeriod && record.period <= lastPeriod).map((record) => record.period));
await mkdir(root, { recursive: true });
let action = await writeIfChanged(`${root}/tvshow.nfo`, `<?xml version="1.0" encoding="UTF-8"?>\n<tvshow><title>General Conference</title><sorttitle>General Conference</sorttitle><genre>Religious</genre></tvshow>\n`);
sidecarLog("General Conference", "tvshow.nfo", action);
 action = await writeIfChanged(`${root}/.plexmatch`, "title=General Conference\ntype=show\n");
sidecarLog("General Conference", ".plexmatch", action);

for (const period of [...periods].sort()) {
  const folder = folderCode(period);
  const code = seasonCode(period);
  const [year, month] = period.split("-");
  const label = month === "04" ? `April ${year} General Conference` : `October ${year} General Conference`;
  const seasonDirectory = `${root}/Season ${folder}`;
  if (!(await hasMedia(seasonDirectory))) {
    sidecarLog(`Season ${code}`, "skipped (no media)", "");
    continue;
  }
  await mkdir(seasonDirectory, { recursive: true });
  const seasonRecord = metadata.find((item) => item.period === period && item.kind !== "season");
  const seasonLinks = seasonRecord ? mediaByURL.get(seasonRecord.page_url) ?? {} : {};
  let seasonMedia = {};
  if (seasonRecord) {
    try { seasonMedia = await pageMedia(seasonRecord.page_url); }
    catch (error) { console.warn(`season artwork lookup failed ${period}: ${error.message}`); }
  }
  action = await ensureFetched("./data/artwork/season.jpg", `${seasonDirectory}/poster.jpg`, () => fetchBinary(seasonLinks.season_artwork_url || seasonMedia.seasonPoster));
  sidecarLog(`Season ${code}`, "poster.jpg", action);
  action = await writeIfChanged(`${seasonDirectory}/season.nfo`, `<?xml version="1.0" encoding="UTF-8"?>\n<season><title>${xml(label)}</title><seasonnumber>${code}</seasonnumber><year>${year}</year></season>\n`);
  sidecarLog(`Season ${code}`, "season.nfo", action);
  action = await writeIfChanged(`${seasonDirectory}/.plexmatch`, `title=${label}\ntype=season\nseason=${code}\n`);
  sidecarLog(`Season ${code}`, ".plexmatch", action);

  for (const record of selectedMetadata.filter((item) => item.period === period && item.kind !== "season")) {
    const kind = record.kind ?? "talk";
    console.log(`${period}\n  ${record.title}${record.speaker ? ` - ${record.speaker}` : ""}`);
    let stem = `General Conference - S${code} - ${safeName(record.title)}`;
    let episode = "";
    let directory = seasonDirectory;
    const id = pageID(record.page_url);
    const sidecarLabel = `${period}${kind === "talk" ? ` #${String((episodes.get(period) ?? 0) + 1).padStart(2, "0")}` : ""}`;
    if (kind === "talk") {
      const number = (episodes.get(period) ?? 0) + 1;
      episodes.set(period, number);
      episode = String(number).padStart(2, "0");
      stem = `General Conference - S${code}E${episode} - ${safeName(record.title)}`;
      directory = `${seasonDirectory}/${stem}`;
      if (!(await hasMedia(directory))) {
        sidecarLog(sidecarLabel, "skipped (no media)", "");
        continue;
      }
      await mkdir(directory, { recursive: true });
      const links = mediaByURL.get(record.page_url) ?? {};
      let media = {};
      try { media = await pageMedia(record.page_url); }
      catch (error) { console.warn(`media lookup failed ${record.page_url}: ${error.message}`); }
      action = await ensureFetched(`./data/text/${id}.md`, `${directory}/${stem}.md`, () => fetchMarkdown(record.page_url, record.title));
      sidecarLog(sidecarLabel, ".md", action);
      action = await ensureFetched(`./data/subtitles/${id}.en.vtt`, `${directory}/${stem}.vtt`, async () => {
        const subtitleURL = links.subtitle_urls?.split(" | ")[0] || "";
        return subtitleURL ? fetchText(subtitleURL) : fetchSubtitle(media.videoID);
      });
      sidecarLog(sidecarLabel, ".vtt", action);
      action = await ensureFetched(`./data/artwork/${id}.jpg`, `${directory}/${stem}.jpg`, () => fetchBinary(links.episode_artwork_url || media.poster));
      sidecarLog(sidecarLabel, ".jpg", action);
      action = await writeIfChanged(`${directory}/.plexmatch`, `title=${record.title}\ntype=episode\nseason=${code}\nepisode=${episode}\n`);
      sidecarLog(sidecarLabel, ".plexmatch", action);
    } else {
      directory = `${seasonDirectory}/Sessions`;
      if (!(await hasMedia(directory))) {
        console.log(`${period}\n  ${record.title} - skipped (no media)`);
        continue;
      }
      await mkdir(directory, { recursive: true });
    }
    const nfo = `<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails><title>${xml(record.title)}</title><showtitle>General Conference</showtitle><season>${code}</season>${episode ? `<episode>${episode}</episode>` : ""}<plot>${xml(record.description)}</plot>${record.speaker ? `<actor><name>${xml(record.speaker)}</name></actor>` : ""}</episodedetails>\n`;
    action = await writeIfChanged(`${directory}/episode.nfo`, nfo);
    sidecarLog(sidecarLabel, ".nfo", action);
    if (kind !== "talk") {
      action = await copyIfPresent(`./data/text/${id}.md`, `${directory}/${stem}.md`);
      sidecarLog(sidecarLabel, ".md", action);
      action = await copyIfPresent(`./data/subtitles/${id}.en.vtt`, `${directory}/${stem}.vtt`);
      sidecarLog(sidecarLabel, ".vtt", action);
      action = await copyIfPresent(`./data/artwork/${id}.jpg`, `${directory}/${stem}.jpg`);
      sidecarLog(sidecarLabel, ".jpg", action);
    }
  }
}
console.log(`Generated sidecars for ${periods.size} seasons`);
