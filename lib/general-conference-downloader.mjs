import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as JSDOM from "jsdom";
import { Defuddle } from "defuddle/node";
import TurndownService from "turndown";
import * as TurndownGFM from "turndown-plugin-gfm";

const execFileAsync = promisify(execFile);
const SHOW_MATCH_NAME =
  "General Conference of The Church of Jesus Christ of Latter-day Saints";

async function exists(path) {
  let info = await stat(path).catch(function (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
  return Boolean(info?.size);
}
async function mediaValid(path) {
  if (!(await exists(path))) {
    return false;
  }
  await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  return true;
}
async function downloadURL(url, path, validate = null) {
  let part = `${path}.part`;
  let present = await exists(path);
  if (present && (!validate || (await validate(path)))) {
    return "exists";
  }
  let partial = await stat(part).catch(function (error) {
    if (error.code === "ENOENT") {
      return { size: 0 };
    }
    throw error;
  });
  let partialSize = partial.size;
  await mkdir(dirname(path), { recursive: true });
  let response = await fetch(url, {
    headers: partialSize ? { range: `bytes=${partialSize}-` } : {},
  });
  if (response.status === 416 && partialSize > 0) {
    let total = response.headers
      .get("content-range")
      ?.match(/^bytes \*\/(\d+)$/)?.[1];
    if (total !== String(partialSize)) {
      await rm(part, { force: true });
      return downloadURL(url, path, validate);
    }
    if (!(await mediaValid(part))) {
      await rm(part, { force: true });
      throw Error(`invalid resumed download: ${path}`);
    }
    await rename(part, path);
    return "resumed";
  }
  if (!response.ok && response.status !== 206) {
    throw Error(`${response.status} ${response.statusText}: ${url}`);
  }
  if (!response.body) {
    throw Error(`empty response: ${url}`);
  }
  let append = partialSize > 0 && response.status === 206;
  await pipeline(
    Readable.fromWeb(response.body),
    createWriteStream(part, { flags: append ? "a" : "w" }),
  );
  if ((validate || append) && !(await (validate ?? mediaValid)(part))) {
    await rm(part, { force: true });
    throw Error(`invalid download: ${path}`);
  }
  await rename(part, path);
  return append ? "resumed" : "downloaded";
}
async function fetchMarkdown(url, title) {
  let response = await fetch(url, {
    headers: {
      accept: "text/html",
      "user-agent": "General-Conference-to-Audiobook/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw Error(`${response.status} ${response.statusText}: ${url}`);
  }
  let html = await response.text();
  let dom = new JSDOM.JSDOM(html, { url, runScripts: "outside-only" });
  let article = await Defuddle(dom.window.document, url);
  let markdown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
  });
  markdown.use(TurndownGFM.gfm);
  let content = article?.content ?? "";
  return `# ${title}\n\n${markdown.turndown(content).trim()}\n`;
}
async function fetchToFile(url, path, binary = false) {
  if (!url || (await exists(path))) {
    return "exists";
  }
  let response = await fetch(url);
  if (!response.ok) {
    throw Error(`${response.status} ${url}`);
  }
  await mkdir(dirname(path), { recursive: true });
  let content;
  if (binary) {
    content = Buffer.from(await response.arrayBuffer());
  } else {
    content = await response.text();
  }
  await writeFile(path, content);
  return "downloaded";
}
function actorXML(speaker) {
  if (!speaker) {
    return "";
  }
  return `<actor><name>${xml(speaker)}</name></actor>`;
}
function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
async function writeSidecars(row, paths, onStatus = function () {}) {
  async function sidecar(name, url, path, binary) {
    let present = await exists(path);
    if (present) {
      onStatus(name, "exists");
      return;
    }
    if (!url || /^(?:\\N|none)$/i.test(String(url).trim())) {
      onStatus(name, "unavailable");
      return;
    }
    onStatus(name, "downloading");
    let action = await fetchToFile(url, path, binary);
    let finalStatus = action;
    if (action === "downloaded") {
      finalStatus = "OK";
    }
    onStatus(name, finalStatus);
  }
  let textPresent = await exists(paths.text);
  if (textPresent) {
    onStatus(".md", "exists");
  } else if (!row.text_url) {
    onStatus(".md", "unavailable");
  } else {
    onStatus(".md", "downloading");
    await writeFile(paths.text, await fetchMarkdown(row.text_url, row.title));
    onStatus(".md", "OK");
  }
  await sidecar(".vtt", row.subtitle_url, paths.subtitle, false);
  await sidecar("poster.jpg", row.artwork_url, paths.artwork, true);
  await writeFile(
    paths.episode,
    `<?xml version="1.0" encoding="UTF-8"?>\n<episodedetails><title>${xml(row.title)}</title><showtitle>${xml(paths.showName ?? "General Conference")}</showtitle><season>${xml(paths.season)}</season><episode>${xml(paths.episodeNumber ?? "")}</episode><plot>${xml(row.description)}</plot>${actorXML(row.speaker)}</episodedetails>\n`,
  );
  onStatus(".plexmatch", "generated");
  onStatus("episode.nfo", "generated");
  await writeFile(
    paths.plex,
    `title=${row.title}\ntype=episode\nseason=${paths.season}\nepisode=${paths.episodeNumber ?? ""}\n`,
  );
}
async function writeShowSidecars(root, showName = "General Conference") {
  await writeFile(
    `${root}/tvshow.nfo`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<tvshow><title>${xml(showName)}</title><sorttitle>${xml(showName)}</sorttitle><genre>Religious</genre></tvshow>\n`,
  );
  await writeFile(`${root}/.plexmatch`, `title=${SHOW_MATCH_NAME}\ntype=show\n`);
}
async function writeSeasonSidecars(
  directory,
  artworkURL,
  title,
  code,
  year,
  onStatus = function () {},
) {
  let poster = `${directory}/poster.jpg`;
  let posterAction = await fetchToFile(artworkURL, poster, true);
  onStatus("poster.jpg", posterAction === "downloaded" ? "OK" : posterAction);
  await writeFile(
    `${directory}/season.nfo`,
    `<?xml version="1.0" encoding="UTF-8"?>\n<season><title>${xml(title)}</title><seasonnumber>${xml(code)}</seasonnumber><year>${xml(year)}</year></season>\n`,
  );
  onStatus("season.nfo", "generated");
  await writeFile(
    `${directory}/.plexmatch`,
    `title=${title}\ntype=season\nseason=${code}\n`,
  );
  onStatus(".plexmatch", "generated");
}

export default {
  exists,
  mediaValid,
  downloadURL,
  fetchToFile,
  fetchMarkdown,
  xml,
  writeSidecars,
  writeShowSidecars,
  writeSeasonSidecars,
};
