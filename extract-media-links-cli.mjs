#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const conferenceURL = process.argv[2];
const outputPath = process.argv[3] ?? "./data/media-links.json";
const requestHeaders = { "user-agent": "General-Conference-to-Audiobook/1.0" };

if (!conferenceURL) {
  console.error("usage: extract-media-links-cli.mjs CONFERENCE_URL [OUTPUT_JSON]");
  process.exit(2);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchHTML(url) {
  const response = await fetch(url, { headers: requestHeaders });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function initialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__="([^"]+)"/);
  if (!match) throw new Error("initial state not found");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}

function canonicalURL(href) {
  const url = new URL(href);
  url.search = "?lang=eng";
  url.hash = "";
  return url.href;
}

function pageURLs(html, baseURL) {
  const base = new URL(baseURL);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  return [...new Set(hrefs
    .map((href) => new URL(href, base).href)
    .filter((href) => {
      const url = new URL(href);
      return url.origin === base.origin &&
        url.pathname.startsWith(base.pathname + "/") &&
        url.pathname.split("/").length === base.pathname.split("/").length + 1;
    })
    .map(canonicalURL))];
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]+)"`, "i"));
  return match?.[1] ?? "";
}

function mediaRecord(html, url) {
  const state = initialState(html);
  const page = Object.values(state.reader?.contentStore ?? {})[0];
  if (!page) throw new Error("content record not found");

  const body = page.content?.body ?? "";
  const videoTag = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
  const sources = [...body.matchAll(/<source\b[^>]*>/gi)].map((match) => ({
    url: attribute(match[0], "src"),
    type: attribute(match[0], "type"),
  }));
  const audio = (page.meta?.audio ?? []).map((item) =>
    item.mediaUrl.includes("download=true") ? item.mediaUrl : `${item.mediaUrl}?download=true`
  );
  const video = sources
    .filter((source) => /\.mp4(?:\?|$)/i.test(source.url))
    .map((source) => source.url.includes("download=true") ? source.url : `${source.url}?download=true`);

  return {
    title: page.meta?.title ?? "",
    speaker: (body.match(/>By ([^<]+)</i)?.[1] ?? "").trim(),
    description: page.meta?.description ?? "",
    url: canonicalURL(url),
    audio: [...new Set(audio)],
    video: [...new Set(video)],
    video_streams: [...new Set(sources.filter((source) => source.url).map((source) => source.url))],
    artwork: {
      season: page.meta?.ogTagImageUrl ?? "",
      episode: attribute(videoTag, "poster"),
      thumbnail: attribute(videoTag, "thumbnail"),
    },
    asset_id: attribute(videoTag, "data-assetId"),
    video_id: attribute(videoTag, "data-video-id"),
  };
}

let records = [];
try {
  const previous = JSON.parse(await readFile(outputPath, "utf8"));
  records = Array.isArray(previous.records) ? previous.records : [];
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const conferenceHTML = await fetchHTML(conferenceURL);
const urls = pageURLs(conferenceHTML, conferenceURL);
const done = new Set(records.map((record) => record.url));
const pending = urls.filter((url) => !done.has(url));
console.log(`Found ${urls.length} pages; ${records.length} already complete; ${pending.length} remaining`);

let batchSize = 1;
let offset = 0;
while (offset < pending.length) {
  const currentBatchSize = batchSize;
  const batch = pending.slice(offset, offset + currentBatchSize);
  console.log(`\nBatch ${offset + 1}-${offset + batch.length} of ${pending.length}`);
  for (const url of batch) {
    try {
      const record = mediaRecord(await fetchHTML(url), url);
      records.push(record);
      await writeFile(outputPath, JSON.stringify({ conferenceURL, records }, null, 2) + "\n");
      console.log(`  ${record.title}: audio=${record.audio.length} video=${record.video.length}`);
    } catch (error) {
      console.warn(`  failed ${url}: ${error.message}`);
    }
    await sleep(100);
  }
  offset += currentBatchSize;
  batchSize *= 2;
}

await writeFile(outputPath, JSON.stringify({ conferenceURL, records }, null, 2) + "\n");
console.log(`\nWrote ${records.length} records to ${outputPath}`);
