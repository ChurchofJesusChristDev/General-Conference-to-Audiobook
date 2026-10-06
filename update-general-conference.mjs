#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import Metadata from "./lib/general-conference-metadata.mjs";

let args = process.argv.slice(2);
function option(name, fallback) {
  let index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }
  return fallback;
}
let landingURL = option(
  "--index",
  "https://www.churchofjesuschrist.org/study/general-conference?lang=eng",
);
let talksPath = option("--talks", "./talks.tsv");
let mediaPath = option("--media", "./cache/media-links.tsv");
let conferencesPath = option("--conferences", "./conferences.tsv");
function latestConferencePeriod(date = new Date()) {
  let year = date.getFullYear();
  for (let period of [`${year}-10`, `${year}-04`]) {
    let [periodYear, month] = period.split("-").map(Number);
    let firstDay = new Date(periodYear, month - 1, 1);
    let firstSunday = 1 + ((7 - firstDay.getDay()) % 7);
    let available = new Date(periodYear, month - 1, firstSunday + 3);
    if (date >= available) return period;
  }
  return `${year - 1}-10`;
}
function shiftConference(period, count) {
  let [year, month] = period.split("-").map(Number);
  let conferenceIndex = 0;
  if (month === 10) {
    conferenceIndex = 1;
  }
  let index = year * 2 + conferenceIndex - count;
  let resultMonth = "10";
  if (index % 2 === 0) {
    resultMonth = "04";
  }
  return `${Math.floor(index / 2)}-${resultMonth}`;
}
let defaultStart = latestConferencePeriod();
let defaultEnd = shiftConference(defaultStart, 3);
let all = args.includes("--all");
let firstPeriod = option("--start", defaultStart);
let lastPeriod = option("--end", defaultEnd);
if (all && !args.includes("--start")) {
  firstPeriod = "1971-04";
}
if (all && !args.includes("--end")) {
  lastPeriod = defaultStart;
}
let rangeLow = firstPeriod;
let rangeHigh = lastPeriod;
if (firstPeriod > lastPeriod) {
  rangeLow = lastPeriod;
  rangeHigh = firstPeriod;
}
let refresh = args.includes("--refresh");
let policyKey = process.env.GENERAL_CONFERENCE_BRIGHTCOVE_POLICY_KEY ?? "";
function negativeSubtitleCache(value) {
  return /^(?:\\N|none)$/i.test(String(value ?? "").trim());
}
let concurrency = Math.max(
  1,
  Number(option("--concurrency", process.env.CONFERENCE_CONCURRENCY ?? "20")),
);
let text = function (path) {
  return readFile(path, "utf8").catch(function (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  });
};
async function main() {
  let landingHTML = await Metadata.fetchHTML(landingURL);
  let artwork = Metadata.artworkFromIndex(landingHTML, landingURL);
  let decadeLinks = Metadata.linksFromHTML(landingHTML, landingURL).filter(
    function (url) {
      let match = new URL(url).pathname.match(
        /\/general-conference\/(\d{4})(\d{4})$/,
      );
      if (!match) return false;
      return `${match[1]}-01` <= rangeHigh && `${match[2]}-12` >= rangeLow;
    },
  );
  let seasonLinks = new Set(Metadata.seasonLinks(landingHTML, landingURL));
  for (let decadeURL of decadeLinks) {
    let decadeHTML = await Metadata.fetchHTML(decadeURL);
    for (let [period, posterURL] of Metadata.artworkFromIndex(
      decadeHTML,
      decadeURL,
    )) {
      artwork.set(period, posterURL);
    }
    for (let url of Metadata.linksFromHTML(decadeHTML, decadeURL)) {
      if (/\/general-conference\/\d{4}\/\d{2}\?/.test(url)) {
        seasonLinks.add(url);
      }
    }
  }
  let existingTalks = Metadata.parseTSV(await text(talksPath)).map(
    function (row) {
      return { ...row, kind: "talk" };
    },
  );
  let existingMedia = new Map(
    Metadata.parseTSV(await text(mediaPath)).map(function (row) {
      return [row.page_url, row];
    }),
  );
  let discovered = new Map(
    existingTalks.map(function (row) {
      return [
        row.page_url,
        { ...row, ...(existingMedia.get(row.page_url) ?? {}) },
      ];
    }),
  );
  let existingEpisode = new Map();
  for (let row of existingTalks) {
    if (row.episode) {
      continue;
    }
    let number = (existingEpisode.get(row.period) ?? 0) + 1;
    existingEpisode.set(row.period, number);
    discovered.get(row.page_url).episode = String(number).padStart(2, "0");
  }
  let conferenceText = await text(conferencesPath);
  let conferenceRows = Metadata.parseTSV(conferenceText);
  let conferenceFields = ["period", "president", "poster_url"];
  if (conferenceText.trimEnd()) {
    conferenceFields = conferenceText.trimEnd().split("\n")[0].split("\t");
  }
  let conferences = new Map(
    conferenceRows.map(function (row) {
      return [row.period, row];
    }),
  );
  for (let [period, posterURL] of artwork) {
    if (conferences.has(period)) {
      conferences.get(period).poster_url = posterURL;
    }
  }
  let stableFields = [
    "period",
    "decade",
    "session",
    "episode",
    "title",
    "speaker",
    "description",
    "page_url",
  ];
  async function writeAtomic(path, content) {
    let temporaryPath = `${path}.part`;
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, path);
  }
  async function checkpoint() {
    let rows = [...discovered.values()].sort(function (a, b) {
      let periodOrder = a.period.localeCompare(b.period);
      if (periodOrder !== 0) {
        return periodOrder;
      }
      let episodeOrder = Number(a.episode || 0) - Number(b.episode || 0);
      if (episodeOrder !== 0) {
        return episodeOrder;
      }
      return a.page_url.localeCompare(b.page_url);
    });
    await mkdir(dirname(talksPath), { recursive: true });
    await writeAtomic(
      talksPath,
      Metadata.writeTSV(
        rows.filter(function (row) {
          return row.kind === "talk";
        }),
        stableFields,
      ),
    );
    await mkdir(dirname(mediaPath), { recursive: true });
    await writeAtomic(mediaPath, Metadata.writeTSV(rows));
    await mkdir(dirname(conferencesPath), { recursive: true });
    await writeAtomic(
      conferencesPath,
      Metadata.writeTSV(conferenceRows, conferenceFields),
    );
    console.log(`Checkpointed ${rows.length} metadata rows`);
  }
  for (let seasonURL of [...seasonLinks].sort()) {
    let period = Metadata.periodFor(seasonURL);
    if (period < rangeLow || period > rangeHigh) continue;
    let seasonHTML = await Metadata.fetchHTML(seasonURL);
    let decade =
      decadeLinks.find(function (url) {
        return url.includes(period.slice(0, 3));
      }) ?? "";
    let pages = Metadata.linksFromHTML(seasonHTML, seasonURL).filter(
      function (url) {
        return new URL(url).pathname.startsWith(
          new URL(seasonURL).pathname + "/",
        );
      },
    );
    let pendingPages = [...new Set(pages)];
    let episodeNumbers = new Map();
    let sessionNumbers = new Map();
    let session = 0;
    for (let pageURL of pendingPages) {
      let kind = Metadata.kindFor(pageURL);
      if (kind === "session") {
        session += 1;
        sessionNumbers.set(pageURL, session);
        continue;
      }
      if (kind !== "talk") {
        continue;
      }
      let number = (episodeNumbers.get(period) ?? 0) + 1;
      episodeNumbers.set(period, number);
      episodeNumbers.set(pageURL, String(number).padStart(2, "0"));
    }
    await Metadata.parallel(
      concurrency,
      pendingPages,
      async function (pageURL) {
        if (!refresh && discovered.has(pageURL) && existingMedia.has(pageURL)) {
          return;
        }
        await (async function () {
          let row = Metadata.pageRecord(
            await Metadata.fetchHTML(pageURL),
            pageURL,
            decade,
          );
          row.season_artwork_url =
            artwork.get(row.period) ?? row.season_artwork_url ?? "";
          row.session = sessionNumbers.get(pageURL) ?? "";
          row.episode = episodeNumbers.get(pageURL) ?? "";
          if (row.kind === "season") {
            return;
          }
          let cachedSubtitle = existingMedia.get(pageURL)?.subtitle_url ?? "";
          if (negativeSubtitleCache(cachedSubtitle) || !policyKey || !row.video_id) {
            row.subtitle_url = cachedSubtitle;
          } else {
            let subtitleURL = await Metadata.subtitleURL(
              row.video_id,
              policyKey,
            ).catch(function (error) {
              console.warn(`${pageURL}: ${error.message}`);
              return null;
            });
            row.subtitle_url =
              subtitleURL === null ? cachedSubtitle : subtitleURL || "\\N";
          }
          discovered.set(pageURL, row);
          existingMedia.set(pageURL, row);
          console.log(`${period} ${row.kind} ${row.title}`);
        })().catch(function (error) {
          console.warn(`${pageURL}: ${error.message}`);
        });
      },
    );
    await checkpoint();
  }
  await checkpoint();
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
