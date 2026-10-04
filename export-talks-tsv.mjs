#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const metadataPath = process.argv[2] ?? "./cache/metadata.tsv";
const urlsPath = process.argv[3] ?? "./cache/urls.tsv";
const outputPath = process.argv[4] ?? "./talks.tsv";
const parse = (text) => {
  const lines = text.trimEnd().split("\n");
  const headers = lines.shift().split("\t");
  return lines.map((line) => Object.fromEntries(line.split("\t").map((value, index) => [headers[index], value])));
};
const metadata = parse(await readFile(metadataPath, "utf8"));
const urls = new Map(parse(await readFile(urlsPath, "utf8")).map((row) => [row.page_url, row]));
const fields = ["period", "decade", "title", "speaker", "description", "page_url"];
const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
const rows = [fields.join("\t")];
for (const record of metadata.filter((row) => row.kind === "talk" && row.period >= "1971-04" && row.period <= "2026-04")) {
  const media = urls.get(record.page_url) ?? {};
  rows.push(fields.map((field) => clean(record[field] ?? media[field])).join("\t"));
}
await writeFile(outputPath, rows.join("\n") + "\n");
console.log(`Wrote ${rows.length - 1} talks to ${outputPath}`);
