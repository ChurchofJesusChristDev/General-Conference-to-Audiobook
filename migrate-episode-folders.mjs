#!/usr/bin/env node

import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";

const root = process.argv[2] ?? process.env.GENERAL_CONFERENCE_DOWNLOAD_PATH;
const talksPath = process.argv[3] ?? "./talks.tsv";
if (!root) throw new Error("download root is required");
const talkPattern = /^(General Conference - S(?:\d{4}|\d{6})E\d{2} - .+?)(\.(?:m4a\.mp3|m4a\.part|mp4\.part|m4a|mp3|mp4|nfo|md|vtt|jpg))$/;
function safeName(value) {
  return value.replace(/[/:*?"<>|\\]+/g, "-").replace(/\s+/g, " ").trim();
}
const catalog = (await readFile(talksPath, "utf8")).trimEnd().split("\n").slice(1).map((line) => {
  const [period, , title] = line.split("\t");
  return { period, title: safeName(title) };
});
let moved = 0;
let renamed = 0;
let episodeFolders = 0;
for (const season of await readdir(root, { withFileTypes: true })) {
  if (!season.isDirectory() || !/^Season \d{6}$/.test(season.name)) continue;
  const seasonPath = `${root}/${season.name}`;
  const fullCode = season.name.slice("Season ".length);
  const period = `${fullCode.slice(0, 4)}-${fullCode.slice(4)}`;
  const episodeNumbers = new Map(catalog.filter((talk) => talk.period === period).map((talk, index) => [talk.title, String(index + 1).padStart(2, "0")]));
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
    if (entry.isDirectory()) {
      const match = entry.name.match(/^General Conference - S\d{6} - (.+)$/);
      const number = match && episodeNumbers.get(match[1]);
      if (!number) continue;
      const oldStem = entry.name;
      const newStem = `General Conference - S${fullCode}E${number} - ${match[1]}`;
      const directory = `${seasonPath}/${oldStem}`;
      const targetDirectory = `${seasonPath}/${newStem}`;
      await mkdir(targetDirectory, { recursive: true });
      for (const child of await readdir(directory, { withFileTypes: true })) {
        if (!child.isFile() || !child.name.startsWith(oldStem)) continue;
        const source = `${directory}/${child.name}`;
        const target = `${targetDirectory}/${newStem}${child.name.slice(oldStem.length)}`;
        try {
          await rename(source, target);
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          await rm(source);
        }
      }
      await rm(directory, { recursive: true, force: true });
      episodeFolders++;
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
