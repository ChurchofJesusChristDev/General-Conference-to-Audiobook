#!/usr/bin/env node

import { readdir, readFile, rename, stat, writeFile } from "node:fs/promises";

const root = process.argv[2] ?? process.env.GENERAL_CONFERENCE_DOWNLOAD_PATH;
if (!root) throw new Error("download root is required");
let renamed = 0;
async function walk(directory, oldCode, newCode) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const source = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await walk(source, oldCode, newCode);
    if (/\.(?:nfo|plexmatch|md|vtt)$/i.test(entry.name)) {
      const content = await readFile(source, "utf8");
      const updated = content.split(oldCode).join(newCode);
      if (updated !== content) await writeFile(source, updated);
    }
    const targetName = entry.name.split(oldCode).join(newCode);
    if (targetName !== entry.name) {
      await rename(source, `${directory}/${targetName}`);
      renamed++;
    }
  }
}
for (const entry of await readdir(root, { withFileTypes: true })) {
  const match = entry.name.match(/^Season (\d{6})$/);
  if (!entry.isDirectory() || !match) continue;
  const full = match[1];
  const oldCode = `S${full.slice(2)}`;
  const newCode = `S${full}`;
  await walk(`${root}/${entry.name}`, oldCode, newCode);
}
console.log(`Updated ${renamed} season-coded names`);
