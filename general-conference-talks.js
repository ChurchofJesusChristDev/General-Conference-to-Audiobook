"use strict";

function $(sel, $el) {
  return ($el || document).querySelector(sel);
}

function $$(sel, $el) {
  return ($el || document).querySelectorAll(sel);
}

// There should be 5 sessions with 6-9 talks per session
// (plus one header per each)
var CARDS_MINIMUM = 5 * 6;
var CARDS_SELECTOR = "nav ul.doc-map ul.doc-map li a";
var TITLE_SELECTOR = "h4";
var SESSION_SUFFIX = "Session";
var MP3_PAGE_STATE_RE = /window.__INITIAL_STATE__\s*=\s*"([^"]+)"/;
var MP3_CDN_URL_RE = /("https:[^"]*cdn[^"]*[^"]*mp3[^"]*")/g;

function parseTalk($session, $card, talkNumber, domListIndex) {
  // TODO add session info

  let title = parseTitle($card);
  if (title.endsWith("Session")) {
    return null;
  }

  try {
    parseSpeaker($card);
  } catch (e) {
    console.warn($card);
    let err = new Error(
      `Could not parse speaker info for '${title}': e.message`
    );
    window.alert(err.message);
    throw err;
  }

  let speaker = parseSpeaker($card);
  let description = parseDescription($card);
  let url = $card.href;

  let sessionNumberStr = $session.index.toString();

  let talkNumberStr = talkNumber.toString();
  talkNumberStr = talkNumberStr.padStart(2, "0");

  let talk = {
    _domListIndex: domListIndex,
    session_number: sessionNumberStr,
    talk_number: talkNumberStr,
    title: title,
    speaker: speaker,
    description: description,
    talk_url: url,
    mp3_url: "",
  };

  return talk;
}

function parseMp3Link(html) {
  // Un-react-ify the page data
  var m = html.match(MP3_PAGE_STATE_RE);
  if (!m) {
    let err = new Error(
      `could not get talk description page state: ${MP3_PAGE_STATE_RE} is no longer the valid selector`
    );
    window.alert(`Error: ${err.message}`);
    throw err;
  }

  var jsonText;
  try {
    jsonText = atob(m[1]);
  } catch (e) {
    // catch more exactly below
  }
  if (!jsonText) {
    let err = new Error(
      `could not parse talk description page state: ${MP3_PAGE_STATE_RE} is no longer the valid selector`
    );
    console.warn(html);
    window.alert(`Error: ${err.message}`);
    throw err;
  }

  var mp3Match = jsonText.match(MP3_CDN_URL_RE);
  if (!mp3Match?.[0]) {
    let err = new Error(
      `could not find talk's mp3 link: ${MP3_CDN_URL_RE} is no longer the valid selector`
    );
    console.warn(jsonText);
    window.alert(`Error: ${err.message}`);
    throw err;
  }

  var mp3Url;
  try {
    mp3Url = JSON.parse(mp3Match[0]);
  } catch (e) {
    // catch more exactly on next line
  }
  if (!mp3Url) {
    let err = new Error(
      `could not parse talk's mp3 link: ${MP3_CDN_URL_RE} is no longer the valid selector`
    );
    console.warn(mp3Match);
    window.alert(`Error: ${err.message}`);
    throw err;
  }

  return mp3Url;
}

function parseTitle($card) {
  return $(TITLE_SELECTOR, $card)?.innerText?.trim() ?? "";
}

function parseSpeaker($card) {
  return $("h6", $card).innerText.trim();
}

function parseDescription($card) {
  // sustainings do not have a description
  return $(".description", $card)?.innerText?.trim() ?? "";
}

function parseNameByIndex(mp3Url, prefix) {
  let url = new URL(mp3Url);
  let filename = url.pathname.split("/").pop();
  let name = `${prefix}_${filename}`;
  return name;
}

async function main() {
  // using var on purpose because it's easier to test in the console

  var $$cards = $$(CARDS_SELECTOR);
  var hasCards = $$cards?.length >= CARDS_MINIMUM;
  if (!hasCards) {
    let err = new Error(
      `the talk card selector has changed: '${CARDS_SELECTOR}' is no longer correct.`
    );
    window.alert(`Error: ${err.message}`);
    throw err;
  }
  console.info(`✅ selected ${$$cards.length} talk cards`);

  $$cards = Array.from($$cards);

  var $$sessions = [];
  var $session;
  var talks = [];
  var sessionTalkNumber = 0;
  $$cards.forEach(function ($card, i) {
    let title = parseTitle($card);
    console.log(`Title: ${title}`);

    if (title.endsWith("Session")) {
      $session = $card;
      $$sessions.push($card);
      // TODO parse session info
      $session.index = $$sessions.length;
      sessionTalkNumber = 0;
      return;
    }
    console.log($card);

    sessionTalkNumber += 1;
    let talk = parseTalk($session, $card, sessionTalkNumber, i);
    if (!talk) {
      let err = new Error(`the talk selectors have changed`);
      console.warn($testCard);
      window.alert(`Error: ${err.message}`);
      throw err;
    }
    console.info(
      `✅ was able to parse talk ${talk.index}'s description:`,
      talk
    );

    if (!talk.talk_url) {
      let err = new Error(`the talk details link has changed`);
      console.warn($testCard);
      window.alert(`Error: ${err.message}`);
      throw err;
    }
    console.info(
      `✅ Found "${talk.title}" by ${talk.speaker}'s description with link:`
    );
    console.info(`   ${talk.talk_url}`);

    talk.$card = $card;
    talks.push(talk);
    console.info("");
  });
  var hasTalks = talks?.length >= CARDS_MINIMUM;
  if (!hasTalks) {
    let err = new Error(
      `the talk card parser has changed: not enough talks found`
    );
    window.alert(`Error: ${err.message}`);
    throw err;
  }

  console.log(talks);
  console.info("");
  console.info(`✅✅ Parsed Descriptions of All Talks!`);
  console.info("");

  let curls = [];
  for (let talk of talks) {
    let page = await window.fetch(talk.talk_url);
    let html = await page.text();
    talk.mp3_url = parseMp3Link(html);
    console.info(
      `✅ Found S${talk.session_number} T${talk.talk_number} "${talk.title}" by ${talk.speaker}'s description with link:`
    );
    console.info(`   ${talk.talk_url}`);

    let filename = parseNameByIndex(
      talk.mp3_url,
      `${talk.session_number}-${talk.talk_number}`
    );
    let curl = `curl -fL -A 'ChJCDev/1.0' -o "${filename}" '${talk.mp3_url}'`;
    curls.push(curl);

    let downloadHtml = `<h6 style="font-size: 8pt;">${talk.session_number}.${talk.talk_number} Download <a href="${talk.mp3_url}" target="_blank" download="${talk.filename}">"${talk.title}" by ${talk.speaker} ⬇️</a></h6>`;
    talk.$card.insertAdjacentHTML("beforeend", downloadHtml);
    talk.$card.children[0].remove();
  }
  let sh = curls.join("\n");

  console.log(talks);
  console.info("");
  console.info(`✅✅ Fetched MP3s URLs for of All Talks!`);
  console.info("");

  console.info(sh);
}

main().catch(function (err) {
  console.error("Error:");
  console.error(err);
});
