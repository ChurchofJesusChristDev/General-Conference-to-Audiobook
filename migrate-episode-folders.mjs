#!/usr/bin/env node

import { mkdir, readdir, rename } from "node:fs/promises";

const root = process.argv[2] ?? process.env.GENERAL_CONFERENCE_DOWNLOAD_PATH;
if (!root) throw new Error("download root is required");
const talkPattern = /^(General Conference - S(?:\d{4}|\d{6})E\d{2} - .+?)(\.(?:m4a\.mp3|m4a\.part|mp4\.part|m4a|mp3|mp4|nfo|md|vtt|jpg))$/;
let moved = 0;
let renamed = 0;
for (const season of await readdir(root, { withFileTypes: true })) {
  if (!season.isDirectory() || !/^Season \d{6}$/.test(season.name)) continue;
  const seasonPath = `${root}/${season.name}`;
  const fullCode = season.name.slice("Season ".length);
  for (const entry of await readdir(seasonPath, { withFileTypes: true })) {
    if (entry.name === "Sessions" || entry.name === "season.nfo" || entry.name === ".plexmatch" || entry.name === "poster.jpg") continue;
    const directoryMatch = entry.name.match(/^General Conference - S(?:\d{4}|\d{6})E\d{2} - /);
    if (entry.isDirectory() && directoryMatch) {
      const newName = entry.name.replace(/S(?:\d{4}|\d{6})E/, `S${fullCode}E`);
      if (newName !== entry.name) {
        await rename(`${seasonPath}/${entry.name}`, `${seasonPath}/${newName}`);
        renamed++;
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const match = entry.name.match(talkPattern);
    if (!match) continue;
    const stem = match[1].replace(/S(?:\d{4}|\d{6})E/, `S${fullCode}E`);
    const newName = `${stem}${match[2]}`;
    const directory = `${seasonPath}/${stem}`;
    await mkdir(directory, { recursive: true });
    const source = `${seasonPath}/${entry.name}`;
    const target = `${directory}/${newName}`;
    if (source === target) continue;
    try { await rename(source, target); moved++; } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}
console.log(`Moved ${moved} standalone files and renamed ${renamed} episode folders`);
