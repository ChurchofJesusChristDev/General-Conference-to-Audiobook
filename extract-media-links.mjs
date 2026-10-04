#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const conferenceURL = process.argv[2];
const outputPath = process.argv[3] ?? "./data/media-links.json";

if (!conferenceURL) {
  console.error("usage: extract-media-links.mjs CONFERENCE_URL [OUTPUT_JSON]");
  process.exit(2);
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function getPageTarget() {
  const response = await fetch("http://127.0.0.1:61884/json");
  if (!response.ok) throw new Error(`CDP target lookup failed: ${response.status}`);
  const targets = await response.json();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("No Brave page target found");
  return target.webSocketDebuggerUrl;
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextID = 0;
    this.pending = new Map();
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
      else pending.resolve(message.result);
    });
  }

  async open() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  command(method, params = {}) {
    const id = ++this.nextID;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }

  close() {
    this.socket.close();
  }
}

function canonicalURL(href) {
  const url = new URL(href);
  url.search = "?lang=eng";
  url.hash = "";
  return url.href;
}

function isConferencePage(href, baseURL) {
  const url = new URL(href);
  const base = new URL(baseURL);
  return url.origin === base.origin &&
    url.pathname.startsWith(base.pathname + "/") &&
    url.pathname.split("/").length === base.pathname.split("/").length + 1;
}

async function main() {
  const cdp = new CDP(await getPageTarget());
  await cdp.open();

  await cdp.command("Page.navigate", { url: conferenceURL });
  await sleep(5000);
  const pageLinks = await cdp.evaluate(`
    [...document.querySelectorAll('a')]
      .map((anchor) => anchor.href)
      .filter((href) => href)
  `);
  const contentURLs = [...new Set(pageLinks
    .filter((href) => isConferencePage(href, conferenceURL))
    .map(canonicalURL))];
  if (contentURLs.length === 0) throw new Error("No talk or session pages found");

  let records = [];
  try {
    const previous = JSON.parse(await readFile(outputPath, "utf8"));
    records = Array.isArray(previous.records) ? previous.records : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const completedURLs = new Set(records.map((record) => record.url));
  const pendingURLs = contentURLs.filter((url) => !completedURLs.has(url));
  console.log(`Found ${contentURLs.length} pages; ${records.length} already complete; ${pendingURLs.length} remaining`);

  let batchSize = 1;
  let offset = 0;
  while (offset < pendingURLs.length) {
    const currentBatchSize = batchSize;
    const batch = pendingURLs.slice(offset, offset + currentBatchSize);
    console.log(`\nBatch ${offset + 1}-${offset + batch.length} of ${contentURLs.length}`);

    for (const contentURL of batch) {
      console.log(`  ${contentURL}`);
      try {
      await cdp.command("Page.navigate", { url: contentURL });
      await sleep(3500);

      const result = await cdp.evaluate(`
        (() => {
          const contentPlay = [...document.querySelectorAll('button')]
            .find((button) => /^\\s*Play - /.test(button.getAttribute('aria-label') || ''));
          contentPlay?.click();
          const audioPlayer = [...document.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Audio Player');
          audioPlayer?.click();
          return { contentPlay: Boolean(contentPlay), audioPlayer: Boolean(audioPlayer) };
        })()
      `);
      if (!result.contentPlay) console.warn("    content play button not found");
      if (!result.audioPlayer) console.warn("    audio player button not found");
      await sleep(2200);

      await cdp.evaluate(`
        [...document.querySelectorAll('button')]
          .find((button) => button.getAttribute('aria-label') === 'More')?.click()
      `);
      await sleep(500);

      await cdp.evaluate(`
        document.querySelector('button[aria-label="Options"]')?.click()
      `);
      await sleep(300);
      await cdp.evaluate(`
        [...document.querySelectorAll('*')]
          .find((element) => element.children.length === 0 && element.textContent.trim() === 'Download')
          ?.click()
      `);
      await sleep(500);

      const media = await cdp.evaluate(`
        (() => {
          const text = document.body.innerText;
          const speaker = text.match(/\\nBy ([^\\n]+)\\n/)?.[1] || "";
          return {
          title: document.title,
          speaker,
          description: document.querySelector('meta[name="description"]')?.content || "",
          url: location.href,
          audio: [...document.querySelectorAll('a')]
            .map((anchor) => anchor.href)
            .filter((href) => /\\.mp3(?:\\?|$)/i.test(href)),
          video: [...document.querySelectorAll('a')]
            .map((anchor) => anchor.href)
            .filter((href) => /\\.mp4(?:\\?|$)/i.test(href)),
          artwork: {
            season: document.querySelector('meta[property="og:image"]')?.content || "",
            episode: document.querySelector('video[poster]')?.poster || document.querySelector('.video img')?.src || "",
            thumbnail: document.querySelector('video[thumbnail]')?.getAttribute('thumbnail') || "",
          },
          };
        })()
      `);
      media.audio = [...new Set(media.audio)];
      media.video = [...new Set(media.video)];
      records.push(media);
      console.log(`    audio=${media.audio.length} video=${media.video.length}`);
      await writeFile(outputPath, JSON.stringify({ conferenceURL, records }, null, 2) + "\n");
      } catch (error) {
        console.warn(`    failed: ${error.message}`);
      }
    }
    offset += currentBatchSize;
    batchSize *= 2;
  }

  await writeFile(outputPath, JSON.stringify({ conferenceURL, records }, null, 2) + "\n");
  console.log(`\nWrote ${records.length} records to ${outputPath}`);
  cdp.close();
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
