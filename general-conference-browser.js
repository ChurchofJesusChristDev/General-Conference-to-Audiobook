(function () {
  "use strict";

  let cardSelector = "nav ul.doc-map ul.doc-map li a";
  let fields = [
    "period",
    "kind",
    "episode",
    "title",
    "speaker",
    "description",
    "page_url",
    "audio_url",
    "video_360p",
    "video_720p",
    "video_1080p",
    "video_streams",
    "asset_id",
    "video_id",
    "subtitle_url",
    "artwork_url",
    "season_artwork_url",
    "text_url",
  ];
  function clean(value) {
    return String(value ?? "")
      .replace(/[\t\r\n]+/g, " ")
      .trim();
  }
  function attribute(tag, name) {
    return tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1] ?? "";
  }
  function canonical(href) {
    let url = new URL(href);
    url.search = "?lang=eng";
    url.hash = "";
    return url.href;
  }
  function periodFor(url) {
    let parts = new URL(url).pathname.split("/").filter(Boolean);
    let index = parts.findIndex(function (part) {
      return /^\d{4}$/.test(part);
    });
    return `${parts[index] ?? ""}-${parts[index + 1] ?? ""}`;
  }
  function decodeState(html) {
    let match = html.match(/window\.__INITIAL_STATE__\s*=\s*["']([^"']+)["']/);
    if (!match) {
      throw Error("initial state not found");
    }
    return JSON.parse(atob(match[1]));
  }
  function pageRow(html, url, card) {
    let page = Object.values(decodeState(html).reader?.contentStore ?? {})[0];
    if (!page) {
      throw Error("content record not found");
    }
    let body = page.content?.body ?? "";
    let video = body.match(/<video\b[^>]*>/i)?.[0] ?? "";
    let sources = [...body.matchAll(/<source\b[^>]*>/gi)]
      .map(function (match) {
        return attribute(match[0], "src");
      })
      .filter(Boolean);
    function addDownload(value) {
      if (!value || value.includes("download=true")) {
        return value;
      }
      let separator = "?";
      if (value.includes("?")) {
        separator = "&";
      }
      return `${value}${separator}download=true`;
    }
    let videos = Object.fromEntries(
      sources
        .filter(function (source) {
          return /\.mp4(?:\?|$)/i.test(source);
        })
        .map(function (source) {
          return [
            source.match(/-(360|720|1080)p-/)?.[1] ?? "other",
            addDownload(source),
          ];
        }),
    );
    return {
      period: periodFor(url),
      kind: "talk",
      title:
        card.querySelector("h4")?.textContent?.trim() ?? page.meta?.title ?? "",
      speaker: card.querySelector("h6")?.textContent?.trim() ?? "",
      description:
        card.querySelector(".description")?.textContent?.trim() ??
        page.meta?.description ??
        "",
      page_url: canonical(url),
      audio_url: addDownload(page.meta?.audio?.[0]?.mediaUrl ?? ""),
      video_360p: videos[360] ?? "",
      video_720p: videos[720] ?? "",
      video_1080p: videos[1080] ?? "",
      video_streams: sources.join(" | "),
      asset_id: attribute(video, "data-assetId"),
      video_id: attribute(video, "data-video-id"),
      subtitle_url: "",
      artwork_url: attribute(video, "poster") || attribute(video, "thumbnail"),
      season_artwork_url: page.meta?.ogTagImageUrl ?? "",
      text_url: canonical(url),
    };
  }
  function shellQuote(value) {
    return `'${String(value).replace(/'/g, `'"'"'`)}'`;
  }
  function powershellQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
  }
  function downloadLink(name, text, type) {
    let link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob([text], { type: type ?? "text/plain" }),
    );
    link.download = name;
    link.textContent = name;
    link.dataset.download = name;
    return link;
  }
  function showBanner(rows, tsv, sh, ps) {
    document.querySelector("[data-gc-download-banner]")?.remove();
    document.querySelector("[data-gc-download-banner-style]")?.remove();
    let style = document.createElement("style");
    style.dataset.gcDownloadBannerStyle = "";
    style.textContent = `[data-gc-download-banner]{position:fixed;z-index:2147483647;top:1rem;right:1rem;max-width:32rem;padding:1rem 1.25rem;background:#fff;color:#111;border:2px solid #111;border-radius:.5rem;box-shadow:0 .25rem 1rem #0005;font:16px/1.4 system-ui,sans-serif}[data-gc-download-banner] h2{margin:0 2rem .5rem 0;font-size:1.1rem}[data-gc-download-banner] p{margin:.35rem 0}[data-gc-download-banner] nav{display:flex;gap:.75rem;flex-wrap:wrap}[data-gc-download-banner] a{color:#0645ad}[data-gc-download-banner] button{position:absolute;top:.5rem;right:.5rem;border:0;background:transparent;font-size:1.25rem;cursor:pointer}`;
    document.head.append(style);
    let template = document.createElement("template");
    template.innerHTML = `<aside data-gc-download-banner aria-label="General Conference downloads"><h2 data-heading></h2><button type="button" data-close title="Close downloads" aria-label="Close downloads">×</button><p data-description></p><nav data-links></nav></aside>`;
    let fragment = document.importNode(template.content, true);
    let banner = fragment.querySelector("[data-gc-download-banner]");
    fragment.querySelector("[data-heading]").textContent =
      `General Conference downloads (${rows.length} talks)`;
    fragment.querySelector("[data-description]").textContent =
      "The files are ready. Choose a download format:";
    let close = fragment.querySelector("[data-close]");
    close.setAttribute("onclick", "GeneralConferenceDownloads.remove(this)");
    let links = fragment.querySelector("[data-links]");
    links.append(
      downloadLink("general-conference.tsv", tsv, "text/tab-separated-values"),
    );
    links.append(downloadLink("general-conference.sh", sh));
    links.append(downloadLink("general-conference.ps1", ps));
    document.body.prepend(fragment);
  }
  window.GeneralConferenceDownloads = {
    remove: function (button) {
      button.closest("[data-gc-download-banner]")?.remove();
    },
  };
  function makeTSV(rows) {
    return `${fields.join("\t")}\n${rows
      .map(function (row) {
        return fields
          .map(function (field) {
            return clean(row[field]);
          })
          .join("\t");
      })
      .join("\n")}\n`;
  }
  async function parallel(limit, items, task) {
    let results = Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        let index = next++;
        results[index] = await task(items[index], index, items);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, worker),
    );
    return results;
  }
  async function main() {
    let cards = [...document.querySelectorAll(cardSelector)];
    if (cards.length < 30) {
      throw Error(`expected at least 30 talk cards, found ${cards.length}`);
    }
    let jobs = [];
    let session = 0;
    let number = 0;
    for (let card of cards) {
      let title = card.querySelector("h4")?.textContent?.trim() ?? "";
      if (title.endsWith("Session")) {
        session++;
        number = 0;
        continue;
      }
      number++;
      jobs.push({
        card: card,
        session: session,
        episode: String(number).padStart(2, "0"),
      });
    }
    let concurrency = 6;
    let talks = await parallel(concurrency, jobs, async function (job) {
      let response = await fetch(job.card.href).catch(function (error) {
        throw Error(`talk page fetch failed: ${error.message}`);
      });
      let html = await response.text().catch(function (error) {
        throw Error(`talk page read failed: ${error.message}`);
      });
      let row = pageRow(html, job.card.href, job.card);
      row.session = job.session;
      row.episode = job.episode;
      console.info(`Fetched ${row.period} ${row.title}`);
      return row;
    });
    let tsv = makeTSV(talks);
    let sh =
      ["#!/bin/sh", "set -eu"]
        .concat(
          talks.map(function (row) {
            let name = `${row.session}-${row.episode}-${row.title.replace(/[^A-Za-z0-9._-]+/g, "-")}.mp3`;
            return `curl -fsSL --output ${shellQuote(name)} ${shellQuote(row.audio_url)}`;
          }),
        )
        .join("\n") + "\n";
    let ps =
      ["$ErrorActionPreference = 'Stop'"]
        .concat(
          talks.map(function (row) {
            let name = `${row.session}-${row.episode}-${row.title.replace(/[^A-Za-z0-9._-]+/g, "-")}.mp3`;
            return `Invoke-WebRequest -Uri ${powershellQuote(row.audio_url)} -OutFile ${powershellQuote(name)}`;
          }),
        )
        .join("\n") + "\n";
    showBanner(talks, tsv, sh, ps);
    console.info(`Created download links for ${talks.length} talks`);
  }
  main().catch(function (error) {
    console.error(error);
  });
})();
