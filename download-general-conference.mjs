#!/usr/bin/env node
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import Metadata from "./lib/general-conference-metadata.mjs";
import Download from "./lib/general-conference-downloader.mjs";

let args = process.argv.slice(2);
function option(name, fallback) {
  let index = args.indexOf(name);
  if (index >= 0) {
    return args[index + 1];
  }
  return fallback;
}
function expandHome(path) {
  if (!path) return path;
  return path
    .replace(/^~(?=\/|$)/, process.env.HOME)
    .replace(/^\$HOME(?=\/|$)/, process.env.HOME);
}
function joinPath(parent, name) {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}
function safeName(value) {
  return String(value)
    .replace(/[/:*?"<>|\\]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
function folderCode(period) {
  return period.replace("-", "");
}
function sourceExtension(url) {
  return (
    new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "bin"
  );
}
function qualityURL(row, preferred) {
  let values = new Map([
    ["360p", row.video_360p],
    ["720p", row.video_720p],
    ["1080p", row.video_1080p],
  ]);
  let order = [preferred, "1080p", "720p", "360p"];
  for (let quality of [...new Set(order)]) {
    if (values.get(quality))
      return { quality: quality, url: values.get(quality) };
  }
  return null;
}
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
function speakerSuffix(speaker) {
  if (!speaker) {
    return "";
  }
  return ` - ${speaker}`;
}
function isDirectory(path) {
  return stat(path)
    .then(function (info) {
      return info.isDirectory();
    })
    .catch(function (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}
let directoryCache = new Map();
async function relocateExisting(root, period, title, target) {
  if (await isDirectory(target)) {
    return;
  }
  let code = folderCode(period);
  let seasonRoot = `${root}/Season ${code}`;
  let othersRoot = `${seasonRoot}/Others`;
  let locations = [seasonRoot, othersRoot];
  let suffix = ` - ${safeName(title)}`;
  for (let location of locations) {
    let entries = directoryCache.get(location);
    if (!entries) {
      entries = await readdir(location, { withFileTypes: true }).catch(
        function (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      );
      directoryCache.set(location, entries);
    }
    for (let entry of entries) {
      if (!entry.isDirectory() || entry.name === "Others") {
        continue;
      }
      if (!entry.name.endsWith(suffix)) {
        continue;
      }
      let source = `${location}/${entry.name}`;
      await mkdir(`${target}/..`, { recursive: true });
      console.log(`MOVE ${source} -> ${target}`);
      await rename(source, target);
      directoryCache.set(
        location,
        entries.filter(function (cachedEntry) {
          return cachedEntry.name !== entry.name;
        }),
      );
      return;
    }
  }
}
async function main() {
  let envPath = option("--env", "./example.env");
  let envText = await readFile(envPath, "utf8");
  let env = Object.fromEntries(
    [...envText.matchAll(/^export\s+([A-Z0-9_]+)=['"](.*)['"]\s*$/gm)].map(
      function (match) {
        return [match[1], match[2]];
      },
    ),
  );
  let showName = env.GENERAL_CONFERENCE_SHOW_NAME ?? "General Conference";
  let showsParent = env.GENERAL_CONFERENCE_SHOWS_PATH ?? "~/Videos/";
  let showsOption = option("--shows-dir", "");
  let showsRoot = joinPath(expandHome(showsParent), showName);
  if (showsOption) {
    showsRoot = expandHome(showsOption);
  }
  let podcastName = env.GENERAL_CONFERENCE_PODCAST_NAME ?? showName;
  let podcastParent = env.GENERAL_CONFERENCE_PODCASTS_PATH ?? showsParent;
  if (!showsRoot) throw Error("GENERAL_CONFERENCE_SHOWS_PATH is required");
  let mediaPath = option("--media", "./cache/media-links.tsv");
  let latest = latestConferencePeriod();
  let all = args.includes("--all");
  let start = option("--start", latest);
  let end = option("--end", shiftConference(latest, 3));
  if (all && !args.includes("--start")) {
    start = "1971-04";
  }
  if (all && !args.includes("--end")) {
    end = latest;
  }
  let rangeLow = start;
  let rangeHigh = end;
  if (start > end) {
    rangeLow = end;
    rangeHigh = start;
  }
  let count = Number(option("--count", "0"));
  let preferred = env.GENERAL_CONFERENCE_VIDEO_QUALITY ?? "720p";
  let rows = (await Metadata.readTSV(mediaPath)).filter(function (row) {
    return (
      row.kind !== "season" && row.period >= rangeLow && row.period <= rangeHigh
    );
  });
  let explicitRange = args.includes("--start") || args.includes("--end");
  let periods = [
    ...new Set(
      rows.map(function (row) {
        return row.period;
      }),
    ),
  ].sort(function (a, b) {
    if (explicitRange && start <= end) {
      return a.localeCompare(b);
    }
    return b.localeCompare(a);
  });
  if (count) periods = periods.slice(0, count);
  let orderedRows = periods.flatMap(function (period) {
    return rows.filter(function (row) {
      return row.period === period;
    });
  });
  let primary = option("--primary", "talks");
  if (primary !== "talks" && primary !== "sessions") {
    throw Error("--primary must be talks or sessions");
  }
  let archive = args.includes("--archive");
  let ffprobe = args.includes("--ffprobe");
  let audioOnly = args.includes("--audio-only");
  let videoOnly = args.includes("--video-only");
  if (audioOnly && videoOnly) {
    throw Error("--audio-only and --video-only cannot be used together");
  }
  let podcastsOption = option("--podcast-dir", "");
  let podcastsRoot = joinPath(expandHome(podcastParent), podcastName);
  if (podcastsOption) {
    podcastsRoot = expandHome(podcastsOption);
  }
  let podcastsDisabled = args.includes("--no-podcasts");
  let includeAudio = !videoOnly && !podcastsDisabled;
  let includeVideo = !audioOnly;
  let selection = "primary only";
  if (archive) {
    selection = "archive (primary and others)";
  }
  let mediaSelection = "video and audio";
  if (audioOnly) {
    mediaSelection = "audio only";
  }
  if (videoOnly) {
    mediaSelection = "video only";
  }
  console.log(`Shows directory: ${showsRoot}`);
  if (podcastsDisabled) {
    console.log("Podcasts: disabled");
  } else {
    console.log(`Podcasts directory: ${podcastsRoot}`);
  }
  console.log(`Primary: ${primary}`);
  console.log(`Selection: ${selection}`);
  console.log(`Media: ${mediaSelection}`);
  let concurrency = Math.max(
    1,
    Number(
      option(
        "--concurrency",
        process.env.CONFERENCE_DOWNLOAD_CONCURRENCY ?? "4",
      ),
    ),
  );
  let jobs = orderedRows.filter(function (row) {
    let isPrimary = row.kind === primary.slice(0, -1);
    if (!archive && !isPrimary) {
      return false;
    }
    let hasAudio = includeAudio && Boolean(row.audio_url);
    let hasVideo = includeVideo && Boolean(qualityURL(row, preferred));
    return hasAudio || hasVideo;
  });
  async function relocateRecord(row) {
    let isPrimary = row.kind === primary.slice(0, -1);
    let directoryPrefix = "";
    if (!isPrimary) {
      directoryPrefix = "Others/";
    }
    let number = row.episode;
    if (row.kind === "session" && row.session) {
      number = `${row.session}01`;
    }
    if (!number) {
      return;
    }
    let code = folderCode(row.period);
    let episodeCode = `E${number}`;
    let showStem = `${showName} - S${code}${episodeCode} - ${safeName(row.title)}`;
    let podcastStem = `${podcastName} - S${code}${episodeCode} - ${safeName(row.title)}`;
    await relocateExisting(
      showsRoot,
      row.period,
      row.title,
      `${showsRoot}/Season ${code}/${directoryPrefix}${showStem}`,
    );
    if (podcastsRoot !== showsRoot) {
      await relocateExisting(
        podcastsRoot,
        row.period,
        row.title,
        `${podcastsRoot}/Season ${code}/${directoryPrefix}${podcastStem}`,
      );
    }
  }
  console.log(`Selected seasons: ${periods.join(", ")}`);
  console.log(
    `Downloading ${jobs.length} items with concurrency ${concurrency}`,
  );
  await mkdir(showsRoot, { recursive: true });
  let talkNumbers = new Map();
  let otherNumbers = new Map();
  let started = 0;
  let showSidecarsReady = false;
  let showSidecarsPromise;
  async function ensureShowSidecars() {
    if (showSidecarsReady) {
      return;
    }
    if (!showSidecarsPromise) {
      showSidecarsPromise = mkdir(showsRoot, { recursive: true })
        .then(function () {
          return Download.writeShowSidecars(showsRoot, showName);
        })
        .then(function () {
          showSidecarsReady = true;
        });
    }
    await showSidecarsPromise;
  }
  for (let period of periods) {
    let seasonRows = orderedRows.filter(function (row) {
      return row.period === period;
    });
    for (let seasonRow of seasonRows) {
      await relocateRecord(seasonRow);
    }
    let seasonVideo = seasonRows.some(function (row) {
      return Boolean(qualityURL(row, preferred));
    });
    if (includeVideo && seasonVideo) {
      let [year, month] = period.split("-");
      let seasonTitle = `${month === "04" ? "April" : "October"} ${year} General Conference`;
      let seasonArtworkURL =
        seasonRows.find(function (row) {
          return row.season_artwork_url;
        })?.season_artwork_url ?? "";
      let seasonDirectory = `${showsRoot}/Season ${folderCode(period)}`;
      await mkdir(seasonDirectory, { recursive: true });
      await Download.writeSeasonSidecars(
        seasonDirectory,
        seasonArtworkURL,
        seasonTitle,
        folderCode(period),
        year,
        function (name, status) {
          console.log(`    ${period}: ${name} ${status}`);
        },
      );
    }
    let seasonJobs = jobs.filter(function (row) {
      return row.period === period;
    });
    await Metadata.parallel(concurrency, seasonJobs, async function (row) {
      let isPrimary = row.kind === primary.slice(0, -1);
      let isOther = !isPrimary;
      let number;
      if (row.kind === "talk" && row.episode) {
        number = row.episode;
      } else if (row.kind === "session" && row.session) {
        number = `${row.session}01`;
      } else {
        let numbers = talkNumbers;
        if (row.kind === "session") {
          numbers = otherNumbers;
        }
        let nextNumber = (numbers.get(row.period) ?? 0) + 1;
        numbers.set(row.period, nextNumber);
        number = String(nextNumber).padStart(2, "0");
        if (row.kind === "session") {
          number = `1${number}`;
        }
      }
      let code = folderCode(row.period);
      let episodePrefix = "E";
      let directoryPrefix = "";
      if (isOther) {
        directoryPrefix = "Others/";
      }
      let episodeCode = `${episodePrefix}${number}`;
      let showStem = `${showName} - S${code}${episodeCode} - ${safeName(row.title)}`;
      let podcastStem = `${podcastName} - S${code}${episodeCode} - ${safeName(row.title)}`;
      let video = qualityURL(row, preferred);
      let showDirectory = `${showsRoot}/Season ${code}/${directoryPrefix}${showStem}`;
      let podcastDirectory = `${podcastsRoot}/Season ${code}/${directoryPrefix}${podcastStem}`;
      let files = [];
      if (includeVideo && video) {
        let directory = showDirectory;
        files.push({
          url: video.url,
          path: `${directory}/${showStem} - ${video.quality}.mp4`,
          label: `video ${video.quality}`,
          video: true,
        });
      }
      if (includeAudio && row.audio_url) {
        let directory = podcastDirectory;
        files.push({
          url: row.audio_url,
          path: `${directory}/${podcastStem}.${sourceExtension(row.audio_url)}`,
          label: "audio",
          audio: true,
        });
      }
      if (!files.length) {
        return;
      }
      console.log(
        `${++started}/${jobs.length} ${row.period} #${episodeCode} - ${row.title}${speakerSuffix(row.speaker)}`,
      );
      for (let file of files) {
        if (
          (ffprobe && (await Download.mediaValid(file.path))) ||
          (!ffprobe && (await Download.exists(file.path)))
        ) {
          console.log(
            `    ${row.period} #${episodeCode}: ${file.label} OK (existing)`,
          );
          if (file.video) {
            await ensureShowSidecars();
          }
          continue;
        }
        let resuming = await Download.exists(`${file.path}.part`);
        let verb = "Downloading";
        if (resuming) {
          verb = "Resuming";
        }
        console.log(`    ${row.period} #${episodeCode}: ${verb} ${file.label}`);
        let action = await Download.downloadURL(
          file.url,
          file.path,
          ffprobe ? Download.mediaValid : null,
        );
        let status = "OK";
        if (action === "resumed") {
          status = "OK (resumed)";
        }
        console.log(
          `    ${row.period} #${episodeCode}: ${file.label} ${status}`,
        );
        if (file.video) {
          await ensureShowSidecars();
        }
      }
      if (includeVideo && video) {
        let directory = showDirectory;
        await Download.writeSidecars(
          row,
          {
            text: `${directory}/${showStem}.md`,
            subtitle: `${directory}/${showStem}.vtt`,
            artwork: `${directory}/poster.jpg`,
            episode: `${directory}/episode.nfo`,
            plex: `${directory}/.plexmatch`,
            season: code,
            episodeNumber: number,
            showName: showName,
          },
          function (name, status) {
            console.log(`    ${row.period} #${episodeCode}: ${name} ${status}`);
          },
        );
      }
    });
  }
  for (let period of periods) {
    if (includeVideo) {
      await mkdir(`${showsRoot}/Season ${folderCode(period)}`, {
        recursive: true,
      });
      await writeFile(
        `${showsRoot}/Season ${folderCode(period)}/download.complete`,
        `${period}\n`,
      );
    }
    if (includeAudio) {
      await mkdir(`${podcastsRoot}/Season ${folderCode(period)}`, {
        recursive: true,
      });
      await writeFile(
        `${podcastsRoot}/Season ${folderCode(period)}/download.complete`,
        `${period}\n`,
      );
    }
  }
}

main().catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
