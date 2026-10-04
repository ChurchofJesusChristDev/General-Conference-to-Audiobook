#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "./data/media-links.json";
const outputDirectory = process.argv[3] ?? "./data/artwork";
const data = JSON.parse(await readFile(inputPath, "utf8"));
await mkdir(outputDirectory, { recursive: true });

async function download(url, path) {
  if (!url) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return true;
}

const seasonURL = data.records.find((record) => record.artwork?.season)?.artwork.season;
if (seasonURL) await download(seasonURL, `${outputDirectory}/season.jpg`);

for (const [index, record] of data.records.entries()) {
  const artworkURL = record.artwork?.episode || record.artwork?.thumbnail;
  const name = new URL(record.url).pathname.split("/").pop();
  if (await download(artworkURL, `${outputDirectory}/${name}.jpg`)) {
    record.artwork_file = `artwork/${name}.jpg`;
  }
  console.log(`${index + 1}/${data.records.length} ${record.title}`);
}

await writeFile(inputPath, JSON.stringify(data, null, 2) + "\n");
