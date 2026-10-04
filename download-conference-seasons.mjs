#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const options = parseArguments(process.argv.slice(2));
const envPath = options.env ?? "./oneal.env";
const talksPath = options.talks ?? options.metadata ?? "./talks.tsv";
const mediaLinksPath = options.media ?? options.urls ?? "./data/media-links.tsv";
function latestAvailablePeriod(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  if (month >= 10) return `${year}-10`;
  if (month >= 4) return `${year}-04`;
  return `${year - 1}-10`;
}
const firstPeriod = options.start ?? latestAvailablePeriod();
const lastPeriod = options.end ?? "1971-04";
const env = parseEnv(await readFile(envPath, "utf8"));
const root = expandHome(env.GENERAL_CONFERENCE_DOWNLOAD_PATH);
const videoQuality = env.GENERAL_CONFERENCE_VIDEO_QUALITY ?? "720p";
const audioFormat = env.GENERAL_CONFERENCE_AUDIO_FORMAT ?? "m4a";
const concurrency = Number(process.env.CONFERENCE_DOWNLOAD_CONCURRENCY ?? "4");

if (!root) throw new Error("GENERAL_CONFERENCE_DOWNLOAD_PATH is required");

function parseArguments(args) {
  const values = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--next" || arg === "--count" || arg === "--start" || arg === "--end" || arg === "--env" || arg === "--talks" || arg === "--media" || arg === "--metadata" || arg === "--urls") {
      values[arg.slice(2)] = args[++i];
    } else if (!arg.startsWith("-")) {
      values.positionals ??= [];
      values.positionals.push(arg);
    }
  }
  if (values.positionals?.length) {
    values.env ??= values.positionals[0];
    values.talks ??= values.positionals[1];
    values.media ??= values.positionals[2];
    values.start ??= values.positionals[3];
    values.end ??= values.positionals[4];
  }
  return values;
}

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
function safeName(value) {
  return value.replace(/[/:*?"<>|\\]+/g, "-").replace(/\s+/g, " ").trim();
}
function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}
function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}
function runVisible(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
async function mediaIsValid(path) {
  let info;
  try { info = await stat(path); } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (info.size === 0) return false;
  await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path]);
  return true;
}
async function download(url, finalPath) {
  const partPath = `${finalPath}.part`;
  if (await mediaIsValid(finalPath)) return "exists";
  await rm(finalPath, { force: true });
  await run("curl", ["--fail", "--location", "--continue-at", "-", "--output", partPath, url]);
  await rename(partPath, finalPath);
  if (!(await mediaIsValid(finalPath))) throw new Error(`invalid media: ${finalPath}`);
  return "downloaded";
}
async function exists(path) {
  try { return (await stat(path)).size > 0; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
const mediaFile = /\.(?:mp3|m4a|mp4|mka|mkv|ogg|oga|opus|flac|wav|webm)$/i;
async function directoryHasMedia(directory) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isFile() && mediaFile.test(entry.name)) return true;
      if (entry.isDirectory() && await directoryHasMedia(path)) return true;
    }
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
function folderCode(period) { return period.replace("-", ""); }
function sourceExtension(url) {
  const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i);
  return match?.[1].toLowerCase() ?? "bin";
}
function audioContainer(codec) {
  if (codec === "aac") return ["m4a", "ipod"];
  if (codec === "mp3") return ["mp3", "mp3"];
  if (codec === "opus" || codec === "vorbis") return ["ogg", "ogg"];
  if (codec === "flac") return ["flac", "flac"];
  throw new Error(`no safe audio container for codec ${codec}`);
}
async function extractAudio(videoPath, outputPath, format) {
  const partPath = `${outputPath}.part`;
  await run("ffmpeg", ["-nostdin", "-y", "-i", videoPath, "-vn", "-map", "0:a:0", "-c:a", "copy", "-f", format, partPath]);
  await rename(partPath, outputPath);
}
function qualityURLs(row) {
  const available = new Map([["360p", row.video_360p], ["720p", row.video_720p], ["1080p", row.video_1080p]]);
  const order = [videoQuality, "1080p", "720p", "360p", ...available.keys()];
  return [...new Set(order)].map((quality) => ({ quality, url: available.get(quality) })).filter((item) => item.url);
}

const metadata = parseTSV(await readFile(talksPath, "utf8"));
const urls = parseTSV(await readFile(mediaLinksPath, "utf8"));
const byURL = new Map(urls.map((row) => [row.page_url, row]));
const rangeLow = firstPeriod <= lastPeriod ? firstPeriod : lastPeriod;
const rangeHigh = firstPeriod <= lastPeriod ? lastPeriod : firstPeriod;
const availablePeriods = [...new Set(metadata.map((meta) => meta.period))]
  .filter((period) => period >= rangeLow && period <= rangeHigh)
  .sort();
const ascending = Boolean(options.start && options.end && options.start <= options.end);
const orderedPeriods = ascending ? availablePeriods : [...availablePeriods].reverse();
let selectedPeriods = orderedPeriods;
if (options.count) selectedPeriods = orderedPeriods.slice(0, Number(options.count));
if (options.next) {
  const incomplete = [];
  for (const period of orderedPeriods) {
    const code = folderCode(period);
    if (!await exists(`${root}/Season ${code}/download.complete`)) incomplete.push(period);
  }
  selectedPeriods = incomplete.slice(0, Number(options.next));
}
const episodes = new Map();
const jobs = [];
const metadataByPeriod = new Map();
for (const meta of metadata) {
  const records = metadataByPeriod.get(meta.period) ?? [];
  records.push(meta);
  metadataByPeriod.set(meta.period, records);
}
for (const period of selectedPeriods) {
  for (const meta of metadataByPeriod.get(period) ?? []) {
    if (meta.kind === "season") continue;
    const kind = meta.kind ?? "talk";
  const row = byURL.get(meta.page_url);
  if (!row) continue;
  const folder = folderCode(meta.period);
  const prefix = `General Conference - S${folder}`;
  let stem = `${prefix} - ${safeName(meta.title)}`;
  let episode = "";
  if (kind === "talk") {
    const number = (episodes.get(meta.period) ?? 0) + 1;
    episodes.set(meta.period, number);
    episode = String(number).padStart(2, "0");
    stem = `${prefix}E${episode} - ${safeName(meta.title)}`;
  } else {
    stem = `${prefix} - ${safeName(meta.title)}`;
  }
  const directory = kind === "session"
    ? `${root}/Season ${folder}/Sessions`
    : `${root}/Season ${folder}/${stem}`;
  const video = qualityURLs(row)[0];
  const files = [];
  if (video) files.push({ type: "video", label: `mp4 (${video.quality})`, path: `${directory}/${stem} - ${video.quality}.mp4`, url: video.url, quality: video.quality });
  if (row.audio_url) {
    const audioURL = audioFormat === "m4a" && row.audio_m4a ? row.audio_m4a : row.audio_url;
    const extension = sourceExtension(audioURL);
    files.push({ type: "audio", label: extension, extension, path: `${directory}/${stem}.${extension}`, url: audioURL });
  } else if (video) {
    files.push({ type: "audio-extract", label: "audio stream", videoPath: `${directory}/${stem} - ${video.quality}.mp4`, videoURL: video.url, directory });
  }
  if (files.length) jobs.push({ period: meta.period, episode, title: meta.title, speaker: meta.speaker, pageURL: meta.page_url, stem, directory, files });
  }
}

console.log(`Selected seasons: ${selectedPeriods.join(", ")}`);
console.log(`Downloading ${jobs.length} items for ${firstPeriod} through ${lastPeriod} with concurrency ${concurrency}`);
let next = 0;
let started = 0;
function itemLabel(job) {
  return `${job.period}${job.episode ? ` #${job.episode}` : ""}`;
}
function itemHeader(job) {
  console.log(`${++started}/${jobs.length} ${itemLabel(job)} - ${job.title}${job.speaker ? ` - ${job.speaker}` : ""}`);
}
function itemStatus(action) {
  return action === "exists" ? "OK (existing)" : "OK";
}
async function downloadVerb(path) {
  return await exists(`${path}.part`) ? "resuming" : "downloading";
}
function errorStatus(error) {
  const code = error.message.match(/(?:error: |HTTP )([45]\d\d)/i)?.[1];
  const names = { 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable" };
  return code ? `${code} ${names[code] ?? "HTTP Error"}` : `failed - ${error.message.split("\n")[0]}`;
}
const failedPeriods = new Set();
let sidecarQueue = Promise.resolve();
function generateEpisodeSidecars(job) {
  sidecarQueue = sidecarQueue.then(() => runVisible(process.execPath, [
    "./generate-conference-sidecars.mjs", envPath, talksPath, job.period, job.period, mediaLinksPath, job.pageURL,
  ]));
  return sidecarQueue;
}
async function processFile(job, file) {
  if (file.type === "audio-extract") {
    console.log(`    ${itemLabel(job)}: ${await downloadVerb(file.videoPath)} mp4 for audio extraction`);
    await download(file.videoURL, file.videoPath);
    const codec = await runCapture("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", file.videoPath]);
    const [extension, format] = audioContainer(codec);
    const outputPath = `${file.directory}/${job.stem}.${extension}`;
    if (!(await mediaIsValid(outputPath))) await extractAudio(file.videoPath, outputPath, format);
    console.log(`    ${itemLabel(job)}: ${extension} OK`);
    return;
  }
  console.log(`    ${itemLabel(job)}: ${await downloadVerb(file.path)} ${file.label}`);
  const action = await download(file.url, file.path);
  console.log(`    ${itemLabel(job)}: ${file.type === "video" ? "mp4" : file.extension} ${itemStatus(action)}`);
}
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    try {
      itemHeader(job);
      await mkdir(job.directory, { recursive: true });
      await Promise.all(job.files.map((file) => processFile(job, file)));
      if (job.files.some((file) => file.type === "video")) await generateEpisodeSidecars(job);
    } catch (error) {
      failedPeriods.add(job.period);
      if (!(await directoryHasMedia(job.directory))) await rm(job.directory, { recursive: true, force: true });
      console.log(`    FAILED - ${errorStatus(error)}`);
      console.warn(`FAILED ${job.period} ${job.title}: ${error.message.split("\n")[0]}`);
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
await sidecarQueue;
for (const period of selectedPeriods) {
  if (failedPeriods.has(period)) continue;
  const code = folderCode(period);
  await writeFile(`${root}/Season ${code}/download.complete`, `${period}\n`);
}
console.log(`Selected seasons: ${selectedPeriods.join(", ")}`);
