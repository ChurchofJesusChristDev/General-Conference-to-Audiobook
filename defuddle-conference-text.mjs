#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const inputPath = process.argv[2] ?? "./data/media-links.json";
const textDirectory = process.argv[3] ?? "./data/text";
const fetcher = "/Users/aj/Skills/pi-skills/defuddle-web-fetch/fetch.js";

function contentOnly(markdown, title) {
  const heading = `# ${title}`;
  const index = markdown.lastIndexOf(heading);
  return index >= 0 ? markdown.slice(index).trim() : markdown.trim();
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
await mkdir(textDirectory, { recursive: true });
for (const [index, record] of data.records.entries()) {
  const filename = `${new URL(record.url).pathname.split("/").pop()}.md`;
  const textPath = `${textDirectory}/${filename}`;
  if (record.text) {
    await writeFile(textPath, `${record.text}\n`);
    delete record.text;
    await writeFile(inputPath, JSON.stringify(data, null, 2) + "\n");
    console.log(`${index + 1}/${data.records.length} moved`);
    continue;
  }
  const result = await execFileAsync("node", [fetcher, "--timeout", "15", record.url], {
    maxBuffer: 1024 * 1024 * 4,
  });
  const text = contentOnly(result.stdout, record.title);
  await writeFile(textPath, `${text}\n`);
  await writeFile(inputPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`${index + 1}/${data.records.length} ${record.title}`);
}
