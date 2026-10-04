#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const outputPath = process.argv[2] ?? "./data/media-links.tsv";
const conferencesPath = process.argv[3] ?? "./data/conferences.tsv";
const landingURL = "https://www.churchofjesuschrist.org/study/general-conference?lang=eng";
const headers = { "user-agent": "General-Conference-to-Audiobook/1.0" };
const canonical = (href) => { const url = new URL(href); url.search = "?lang=eng"; url.hash = ""; return url.href; };
const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
function parseTSV(text) {
  const lines = text.trimEnd().split("\n");
  const headers = lines.shift().split("\t");
  return { headers, rows: lines.map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index], value]))) };
}
function imageFromCard(card) {
  const srcSet = card.match(/srcSet="([^"]+)"/i)?.[1] ?? "";
  const candidates = srcSet.split(",").map((value) => value.trim().split(/\s+/)[0]).filter(Boolean);
  return candidates.at(-1) ?? card.match(/src="([^"]+)"/i)?.[1] ?? "";
}
async function fetchHTML(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}
function artworkFromIndex(html, baseURL) {
  const artwork = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = canonical(new URL(match[1], baseURL).href);
    const period = url.match(/\/general-conference\/(\d{4})\/(04|10)\?/)?.slice(1).join("-");
    if (period) artwork.set(period, imageFromCard(match[2]));
  }
  return artwork;
}
const indexURLs = [landingURL];
const landingHTML = await fetchHTML(landingURL);
for (const match of landingHTML.matchAll(/href="([^"]*\/general-conference\/\d{8}(?:\?lang=eng)?)"/g)) {
  indexURLs.push(canonical(new URL(match[1], landingURL).href));
}
const artwork = artworkFromIndex(landingHTML, landingURL);
for (const url of [...new Set(indexURLs.slice(1))]) {
  for (const [period, image] of artworkFromIndex(await fetchHTML(url), url)) artwork.set(period, image);
}
const table = parseTSV(await readFile(outputPath, "utf8"));
if (!table.headers.includes("season_artwork_url")) table.headers.push("season_artwork_url");
let updated = 0;
for (const row of table.rows) {
  const period = row.page_url.match(/\/general-conference\/(\d{4})\/(04|10)(?:\/|\?)/)?.slice(1).join("-");
  if (!period || !artwork.get(period)) continue;
  row.season_artwork_url = artwork.get(period);
  updated++;
}
const tsv = (row) => table.headers.map((header) => clean(row[header])).join("\t");
await writeFile(outputPath, `${table.headers.join("\t")}\n${table.rows.map(tsv).join("\n")}\n`);
let conferenceText;
try { conferenceText = await readFile(conferencesPath, "utf8"); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (conferenceText) {
  const conferences = parseTSV(conferenceText);
  if (!conferences.headers.includes("poster_url")) conferences.headers.push("poster_url");
  let conferenceUpdates = 0;
  for (const row of conferences.rows) {
    if (!artwork.has(row.period)) continue;
    row.poster_url = artwork.get(row.period);
    conferenceUpdates++;
  }
  const conferenceTSV = (row) => conferences.headers.map((header) => clean(row[header])).join("\t");
  await writeFile(conferencesPath, `${conferences.headers.join("\t")}\n${conferences.rows.map(conferenceTSV).join("\n")}\n`);
  console.log(`Updated ${conferenceUpdates}/${conferences.rows.length} conference catalog rows`);
}
console.log(`Updated ${updated}/${table.rows.length} rows from ${artwork.size} index-page season posters`);
