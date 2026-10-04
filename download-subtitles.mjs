#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "./data/media-links.json";
const outputDirectory = process.argv[3] ?? "./data/subtitles";
const data = JSON.parse(await readFile(inputPath, "utf8"));
await mkdir(outputDirectory, { recursive: true });

for (const [index, record] of data.records.entries()) {
  const pageName = new URL(record.url).pathname.split("/").pop();
  for (const [trackIndex, subtitle] of record.subtitles.entries()) {
    const filename = `${pageName}.${subtitle.language || trackIndex}.vtt`;
    const path = `${outputDirectory}/${filename}`;
    const response = await fetch(subtitle.url);
    if (!response.ok) throw new Error(`${response.status} ${subtitle.url}`);
    await writeFile(path, await response.text());
    subtitle.file = `subtitles/${filename}`;
  }
  await writeFile(inputPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`${index + 1}/${data.records.length} ${record.title}`);
}
