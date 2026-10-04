#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

const landingURL = process.argv[2] ?? "https://www.churchofjesuschrist.org/study/general-conference?lang=eng";
const outputDirectory = process.argv[3] ?? "./cache/all";
const metadataPath = `${outputDirectory}/metadata.tsv`;
const urlsPath = `${outputDirectory}/urls.tsv`;
const headers = { "user-agent": "General-Conference-to-Audiobook/1.0" };
const concurrency = Number(process.env.CONFERENCE_CONCURRENCY ?? "8");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
const tsv = (values) => values.map(clean).join("\t") + "\n";
const canonical = (href) => { const url = new URL(href); url.search = "?lang=eng"; url.hash = ""; return url.href; };
const isConference = (href) => new URL(href).pathname.startsWith("/study/general-conference/");
const linksFromHTML = (html, baseURL) => [...new Set([...html.matchAll(/href="([^"]+)"/g)]
  .map((match) => canonical(new URL(match[1], baseURL).href)).filter(isConference))];

async function fetchHTML(url) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(attempt * 1000);
    }
  }
}

function stateFromHTML(html) {
  const match = html.match(/window\.__INITIAL_STATE__="([^"]+)"/);
  if (!match) throw new Error("initial state not found");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}
function attribute(tag, name) { return tag.match(new RegExp(`${name}="([^"]+)"`, "i"))?.[1] ?? ""; }
function periodFor(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const yearIndex = parts.findIndex((part) => /^\d{4}$/.test(part));
  return `${parts[yearIndex] ?? ""}-${parts[yearIndex + 1] ?? ""}`;
}
function kindFor(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (/^\d{4}$/.test(parts.at(-2) ?? "") && /^\d{2}$/.test(parts.at(-1) ?? "")) return "season";
  if (parts.at(-1)?.includes("session")) return "session";
  return "talk";
}
function recordFromHTML(html, url, decade) {
  const state = stateFromHTML(html);
  const page = Object.values(state.reader?.contentStore ?? {})[0];
  if (!page) throw new Error("content record not found");
  const body = page.content?.body ?? "";
  const videoTag = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
  const sources = [...body.matchAll(/<source\b[^>]*>/gi)].map((match) => ({ url: attribute(match[0], "src"), type: attribute(match[0], "type") })).filter((source) => source.url);
  const addDownload = (value) => value && !value.includes("download=true") ? `${value}?download=true` : value;
  return {
    kind: kindFor(url), period: periodFor(url), decade, title: page.meta?.title ?? "",
    speaker: (body.match(/>By ([^<]+)</i)?.[1] ?? "").trim(),
    description: page.meta?.description ?? "", url: canonical(url),
    audio: [...new Set((page.meta?.audio ?? []).map((item) => addDownload(item.mediaUrl)))],
    video: [...new Set(sources.filter((source) => /\.mp4(?:\?|$)/i.test(source.url)).map((source) => addDownload(source.url)))],
    video_streams: [...new Set(sources.map((source) => source.url))],
    asset_id: attribute(videoTag, "data-assetId"), video_id: attribute(videoTag, "data-video-id"),
  };
}
function videoColumns(record) {
  const values = Object.fromEntries(record.video.map((url) => [url.match(/-(360|720|1080)p-/)?.[1] ?? "other", url]));
  return [values[360] ?? "", values[720] ?? "", values[1080] ?? ""];
}

await mkdir(outputDirectory, { recursive: true });
const metadataHeader = "kind\tperiod\tdecade\ttitle\tspeaker\tdescription\tpage_url\tasset_id\tvideo_id\n";
const urlsHeader = "kind\tperiod\tpage_url\taudio_url\tvideo_360p\tvideo_720p\tvideo_1080p\tvideo_streams\n";
let metadataRows = [];
let urlRows = [];
try {
  metadataRows = (await readFile(metadataPath, "utf8")).trim().split("\n").slice(1);
  urlRows = (await readFile(urlsPath, "utf8")).trim().split("\n").slice(1);
} catch (error) { if (error.code !== "ENOENT") throw error; }
const metadataColumnNames = metadataHeader.trimEnd().split("\t");
const donePageIndex = metadataColumnNames.indexOf("page_url");
const done = new Set(metadataRows.map((line) => line.split("\t")[donePageIndex]).filter(Boolean));
const htmlCache = new Map();
const getHTML = async (url) => { if (!htmlCache.has(url)) htmlCache.set(url, await fetchHTML(url)); return htmlCache.get(url); };
const save = async () => {
  await writeFile(metadataPath, metadataHeader + (metadataRows.length ? `${metadataRows.join("\n")}\n` : ""));
  await writeFile(urlsPath, urlsHeader + (urlRows.length ? `${urlRows.join("\n")}\n` : ""));
};
let saveQueue = Promise.resolve();
const checkpoint = () => {
  saveQueue = saveQueue.then(save);
  return saveQueue;
};

const landingHTML = await getHTML(landingURL);
const landingLinks = linksFromHTML(landingHTML, landingURL);
const decadeLinks = landingLinks.filter((url) => /\/general-conference\/\d{8}\?/.test(url));
const seasonLinks = new Set(landingLinks.filter((url) => /\/general-conference\/\d{4}\/\d{2}\?/.test(url)));
for (const decadeURL of decadeLinks) {
  for (const url of linksFromHTML(await getHTML(decadeURL), decadeURL)) {
    if (/\/general-conference\/\d{4}\/\d{2}\?/.test(url)) seasonLinks.add(url);
  }
}
console.log(`Found ${decadeLinks.length} decade indexes and ${seasonLinks.size} seasons; ${done.size} rows already complete`);

for (const seasonURL of [...seasonLinks].sort()) {
  const seasonHTML = await getHTML(seasonURL);
  const seasonYear = new URL(seasonURL).pathname.split("/").slice(-2, -1)[0];
  const decade = decadeLinks.find((url) => url.includes(seasonYear.slice(0, 3))) ?? "";
  const pages = [seasonURL, ...linksFromHTML(seasonHTML, seasonURL)
    .filter((url) => new URL(url).pathname.startsWith(new URL(seasonURL).pathname + "/"))];
  const pendingPages = [...new Set(pages)].filter((pageURL) => !done.has(pageURL));
  let nextPage = 0;
  const worker = async () => {
    while (nextPage < pendingPages.length) {
      const pageURL = pendingPages[nextPage++];
      try {
        const record = recordFromHTML(await getHTML(pageURL), pageURL, decade);
        metadataRows.push(tsv([record.kind, record.period, record.decade, record.title, record.speaker, record.description, record.url, record.asset_id, record.video_id]).trimEnd());
        urlRows.push(tsv([record.kind, record.period, record.url, record.audio[0] ?? "", ...videoColumns(record), record.video_streams.join(" | ")]).trimEnd());
        done.add(pageURL);
        await checkpoint();
        console.log(`${done.size} ${record.period} ${record.kind} ${record.title}`);
      } catch (error) { console.warn(`failed ${pageURL}: ${error.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, pendingPages.length) }, worker));
}
await save();
console.log(`Wrote ${metadataRows.length} metadata and ${urlRows.length} URL rows`);
