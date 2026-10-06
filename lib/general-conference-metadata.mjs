import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const USER_AGENT = "General-Conference-to-Audiobook/1.0";
const MEDIA_FIELDS = [
  "period",
  "kind",
  "session",
  "episode",
  "title",
  "speaker",
  "description",
  "page_url",
  "decade",
  "audio_url",
  "video_360p",
  "video_720p",
  "video_1080p",
  "video_streams",
  "asset_id",
  "video_id",
  "subtitle_url",
  "artwork_url",
  "season_artwork_url",
  "text_url",
];

const clean = (value) =>
  String(value ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
function parseTSV(text) {
  let lines = [];
  if (text.trimEnd()) {
    lines = text.trimEnd().split("\n");
  }
  let fields = lines.shift()?.split("\t") ?? [];
  return lines.map((line) =>
    Object.fromEntries(line.split("\t").map((value, i) => [fields[i], value])),
  );
}
function writeTSV(rows, fields = MEDIA_FIELDS) {
  return `${fields.join("\t")}\n${rows.map((row) => fields.map((field) => clean(row[field])).join("\t")).join("\n")}\n`;
}
async function readTSV(path) {
  return parseTSV(await readFile(path, "utf8"));
}
async function saveTSV(path, rows, fields = MEDIA_FIELDS) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, writeTSV(rows, fields));
}

function canonical(href) {
  const url = new URL(href);
  url.search = "?lang=eng";
  url.hash = "";
  return url.href;
}
function periodFor(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const index = parts.findIndex((part) => /^\d{4}$/.test(part));
  return `${parts[index] ?? ""}-${parts[index + 1] ?? ""}`;
}
function kindFor(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  if (/^\d{4}$/.test(parts.at(-2) ?? "") && /^\d{2}$/.test(parts.at(-1) ?? ""))
    return "season";
  if (/^\d{8}$/.test(parts.at(-1) ?? "")) return "decade";
  if (parts.at(-1)?.includes("session")) return "session";
  return "talk";
}
function attribute(tag, name) {
  return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? "";
}
function addDownload(url) {
  if (!url || url.includes("download=true")) {
    return url;
  }
  let separator = "?";
  if (url.includes("?")) {
    separator = "&";
  }
  return `${url}${separator}download=true`;
}
function decodeInitialState(html) {
  const match = html.match(/window\.__INITIAL_STATE__\s*=\s*["']([^"']+)["']/);
  if (!match) throw new Error("initial state not found");
  return JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
}
function pageRecord(html, url, decade = "") {
  const state = decodeInitialState(html);
  const page = Object.values(state.reader?.contentStore ?? {})[0];
  if (!page) throw new Error("content record not found");
  const body = page.content?.body ?? "";
  const videoTag = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
  const sources = [...body.matchAll(/<source\b[^>]*>/gi)]
    .map((match) => ({
      url: attribute(match[0], "src"),
      type: attribute(match[0], "type"),
    }))
    .filter((source) => source.url);
  const videos = sources.filter((source) => /\.mp4(?:\?|$)/i.test(source.url));
  const byQuality = Object.fromEntries(
    videos.map(({ url: source }) => [
      source.match(/-(360|720|1080)p-/)?.[1] ?? "other",
      addDownload(source),
    ]),
  );
  const audio = (page.meta?.audio ?? [])
    .map((item) => addDownload(item.mediaUrl))
    .filter(Boolean);
  return {
    period: periodFor(url),
    kind: kindFor(url),
    decade,
    title: page.meta?.title ?? "",
    speaker: (body.match(/>By ([^<]+)</i)?.[1] ?? "").trim(),
    description: page.meta?.description ?? "",
    page_url: canonical(url),
    audio_url: audio[0] ?? "",
    video_360p: byQuality[360] ?? "",
    video_720p: byQuality[720] ?? "",
    video_1080p: byQuality[1080] ?? "",
    video_streams: sources.map((source) => source.url).join(" | "),
    asset_id: attribute(videoTag, "data-assetId"),
    video_id: attribute(videoTag, "data-video-id"),
    artwork_url:
      attribute(videoTag, "poster") || attribute(videoTag, "thumbnail"),
    season_artwork_url: page.meta?.ogTagImageUrl ?? "",
    text_url: canonical(url),
    subtitle_url: "",
  };
}
async function fetchHTML(url, headers = {}) {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT, ...headers },
  });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}
function linksFromHTML(html, baseURL) {
  return [
    ...new Set(
      [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) =>
        canonical(new URL(match[1], baseURL).href),
      ),
    ),
  ].filter((url) =>
    new URL(url).pathname.startsWith("/study/general-conference/"),
  );
}
function imageFromCard(card) {
  const srcSet = card.match(/srcSet=["']([^"']+)["']/i)?.[1] ?? "";
  return (
    srcSet
      .split(",")
      .map((value) => value.trim().split(/\s+/)[0])
      .filter(Boolean)
      .at(-1) ??
    card.match(/src=["']([^"']+)["']/i)?.[1] ??
    ""
  );
}
function artworkFromIndex(html, baseURL) {
  const artwork = new Map();
  for (const match of html.matchAll(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const url = canonical(new URL(match[1], baseURL).href);
    const period = url
      .match(/\/general-conference\/(\d{4})\/(04|10)\?/)
      ?.slice(1)
      .join("-");
    if (period) artwork.set(period, imageFromCard(match[2]));
  }
  return artwork;
}
async function subtitleURL(videoID, policyKey) {
  if (!videoID || !policyKey) return "";
  const response = await fetch(
    `https://edge.api.brightcove.com/playback/v1/accounts/1241706627001/videos/${videoID}`,
    { headers: { accept: `application/json;pk=${policyKey}` } },
  );
  if (!response.ok) throw new Error(`Brightcove ${response.status}`);
  const playback = await response.json();
  const track = (playback.text_tracks ?? []).find(
    (item) => item.kind === "captions" && ["en", "eng"].includes(item.srclang),
  );
  return (
    track?.sources?.[0]?.src?.replace(/^http:/, "https:") ??
    track?.src?.replace(/^http:/, "https:") ??
    ""
  );
}
async function parallel(limit, items, task) {
  let results = Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      let index = next++;
      results[index] = await task(items[index], index, items);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}
function seasonLinks(landingHTML, landingURL) {
  return [
    ...new Set(
      linksFromHTML(landingHTML, landingURL).filter(function (url) {
        return /\/general-conference\/\d{4}\/\d{2}\?/.test(url);
      }),
    ),
  ].sort();
}

export default {
  USER_AGENT,
  MEDIA_FIELDS,
  clean,
  parseTSV,
  writeTSV,
  readTSV,
  saveTSV,
  canonical,
  periodFor,
  kindFor,
  decodeInitialState,
  pageRecord,
  fetchHTML,
  linksFromHTML,
  imageFromCard,
  artworkFromIndex,
  subtitleURL,
  seasonLinks,
  parallel,
};
