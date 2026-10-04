#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2];
const outputDirectory = process.argv[3];
if (!inputPath || !outputDirectory) {
  console.error("usage: export-media-tsv.mjs INPUT_JSON OUTPUT_DIRECTORY");
  process.exit(2);
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
const clean = (value) => String(value ?? "").replace(/[\t\r\n]+/g, " ").trim();
const row = (values) => values.map(clean).join("\t") + "\n";
const records = data.records.map((record) => ({
  ...record,
  period: new URL(record.url).pathname.split("/").slice(-2).join("-"),
}));

let metadata = "kind\tperiod\tdecade\ttitle\tspeaker\tdescription\tpage_url\tasset_id\tvideo_id\n";
let urls = "kind\tperiod\tpage_url\taudio_url\tvideo_360p\tvideo_720p\tvideo_1080p\tvideo_streams\tsubtitle_urls\tseason_artwork_url\tepisode_artwork_url\n";
for (const record of records) {
  metadata += row([
    record.kind, record.period, record.decade, record.title, record.speaker,
    record.description, record.url, record.asset_id, record.video_id,
  ]);
  const videos = Object.fromEntries(record.video.map((url) => {
    const match = url.match(/-(360|720|1080)p-/);
    return [match?.[1] ?? "other", url];
  }));
  urls += row([
    record.kind, record.period, record.url, record.audio[0] ?? "",
    videos[360] ?? "", videos[720] ?? "", videos[1080] ?? "",
    record.video_streams.join(" | "),
    record.subtitles?.map((track) => track.url).join(" | ") ?? "",
    record.artwork?.season ?? "",
    record.artwork?.episode || record.artwork?.thumbnail || "",
  ]);
}

await writeFile(`${outputDirectory}/metadata.tsv`, metadata);
await writeFile(`${outputDirectory}/urls.tsv`, urls);
console.log(`Wrote ${records.length} rows to ${outputDirectory}`);
