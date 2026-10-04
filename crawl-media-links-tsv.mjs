#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const talksPath = process.argv[2] ?? "./talks.tsv";
const outputPath = process.argv[3] ?? "./cache/media-links.tsv";
const refresh = process.argv.includes("--refresh");
const firstPeriod = process.argv[4] ?? "0000-00";
const lastPeriod = process.argv[5] ?? "9999-99";
const headers = { "user-agent": "General-Conference-to-Audiobook/1.0" };
const fields = ["period", "page_url", "audio_url", "video_360p", "video_720p", "video_1080p", "video_streams", "asset_id", "video_id", "season_artwork_url", "episode_artwork_url", "subtitle_urls"];

function parseTSV(text) {
  const lines = text.trimEnd().split("\n");
  const names = lines.shift().split("\t");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((value, i) => [names[i], value])));
}
function tsv(row) { return fields.map((field) => String(row[field] ?? "").replace(/[\t\r\n]+/g, " ")).join("\t"); }
function attribute(tag, name) { return tag.match(new RegExp(`${name}="([^"]+)"`, "i"))?.[1] ?? ""; }
function addDownload(url) { return url && !url.includes("download=true") ? `${url}?download=true` : url; }
async function fetchHTML(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
function extract(html, talk) {
  const stateMatch = html.match(/window\.__INITIAL_STATE__="([^"]+)"/);
  if (!stateMatch) throw new Error("initial state not found");
  const state = JSON.parse(Buffer.from(stateMatch[1], "base64").toString("utf8"));
  const page = Object.values(state.reader?.contentStore ?? {})[0];
  const body = page?.content?.body ?? "";
  const videoTag = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
  const sources = [...body.matchAll(/<source\b[^>]*>/gi)].map((match) => attribute(match[0], "src")).filter(Boolean);
  const videos = sources.filter((url) => /\.mp4(?:\?|$)/i.test(url));
  const byQuality = Object.fromEntries(videos.map((url) => [url.match(/-(360|720|1080)p-/)?.[1], addDownload(url)]));
  return {
    period: talk.period,
    page_url: talk.page_url,
    audio_url: addDownload(page.meta?.audio?.[0]?.mediaUrl ?? ""),
    video_360p: byQuality[360] ?? "",
    video_720p: byQuality[720] ?? "",
    video_1080p: byQuality[1080] ?? "",
    video_streams: sources.join(" | "),
    asset_id: attribute(videoTag, "data-assetId"),
    video_id: attribute(videoTag, "data-video-id"),
    season_artwork_url: page.meta?.ogTagImageUrl ?? "",
    episode_artwork_url: attribute(videoTag, "poster") || attribute(videoTag, "thumbnail"),
    subtitle_urls: "",
  };
}

const talks = parseTSV(await readFile(talksPath, "utf8"));
let links = new Map();
try {
  for (const row of parseTSV(await readFile(outputPath, "utf8"))) links.set(row.page_url, row);
} catch (error) { if (error.code !== "ENOENT") throw error; }
const save = async () => {
  const rows = [...links.values()].sort((a, b) => a.page_url.localeCompare(b.page_url));
  await writeFile(outputPath, `${fields.join("\t")}\n${rows.map(tsv).join("\n")}\n`);
};
for (const talk of talks.filter((row) => row.period >= firstPeriod && row.period <= lastPeriod)) {
  const previous = links.get(talk.page_url);
  if (!refresh && previous?.audio_url && (previous.video_720p || previous.video_1080p || previous.video_360p)) {
    console.log(`${talk.period} checked ${talk.title}`);
    continue;
  }
  try {
    links.set(talk.page_url, extract(await fetchHTML(talk.page_url), talk));
    await save();
    console.log(`${talk.period} fetched ${talk.title}`);
  } catch (error) {
    console.warn(`${talk.period} failed ${talk.title}: ${error.message}`);
  }
}
console.log(`Wrote ${links.size} media-link rows to ${outputPath}`);
