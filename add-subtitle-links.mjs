#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const inputPath = process.argv[2] ?? "./data/media-links.json";
const policyKey = process.env.BRIGHTCOVE_POLICY_KEY;
const accountID = "1241706627001";

if (!policyKey) {
  throw new Error("BRIGHTCOVE_POLICY_KEY is required");
}

const data = JSON.parse(await readFile(inputPath, "utf8"));
for (const [index, record] of data.records.entries()) {
  if (!record.video_id) {
    record.subtitles = [];
    continue;
  }
  const endpoint = `https://edge.api.brightcove.com/playback/v1/accounts/${accountID}/videos/${record.video_id}`;
  const response = await fetch(endpoint, {
    headers: { accept: `application/json;pk=${policyKey}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${record.url}`);
  const playback = await response.json();
  record.subtitles = (playback.text_tracks ?? [])
    .filter((track) => track.kind === "captions")
    .map((track) => ({
      url: (track.sources?.[0]?.src ?? track.src).replace(/^http:/, "https:"),
      language: track.srclang ?? "",
      label: track.label ?? "",
      type: track.mime_type ?? "text/webvtt",
    }));
  await writeFile(inputPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`${index + 1}/${data.records.length} ${record.title}: ${record.subtitles.length} subtitle track(s)`);
}
