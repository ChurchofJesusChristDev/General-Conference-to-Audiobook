# Download General Conference (and convert to Audiobook)

**Updated** for the April 2022 General Conference

Convert the official General Conference website listing into an unofficial Audiobook for easy listening on any device, in any app.

1. Go to any of the General Conference listings (from April 1971 to Present). For example:
   - https://www.churchofjesuschrist.org/study/general-conference/2021/10
   - https://www.churchofjesuschrist.org/study/general-conference/1971/04
2. Open Chrome's Menu => More Tools => Developer Tools (the JavaScript Console Inspector)
3. Copy and Paste this into the Console:
   ```js
   "use strict";

   function $(sel, $el) {
       return ($el || document).querySelector(sel);
   }

   function $$(sel, $el) {
       return ($el || document).querySelectorAll(sel);
   }

   async function getTalk($talk, i = 0) {
       let talk = parseTalk($talk);
       if (!talk) {
           return;
       }
       talk = await scrapeTalk(talk, i);
       return talk;
   }

   function parseTalk($card) {
       let title = parseTitle($card);
       if (title.endsWith("Session")) {
           return null;
       }

       try {
           parseSpeaker($card);
       } catch(err) {
           console.log('DEBUG', $card);
           return null;
       }

       let speaker = parseSpeaker($card);
       let description = parseDescription($card);
       let url = $card.href;

       let talk = {
           filename: "",
           title: title,
           speaker: speaker,
           description: description,
           talk_url: url,
           mp3_url: "",
       };

       return talk;
   }

   async function scrapeTalk(talk, i) {
       let index = (1 + i).toString().padStart(3, "0");

       talk.mp3_url = await fetchMp3Link(talk.talk_url);
       talk.filename = parseNameByIndex(talk, index);
       talk.curl = `curl -fL -A 'TheOne/1.0' -o "${talk.filename}" '${talk.mp3_url}'`;
       talk.html = `<h6 style="font-size: 8pt;">${index}. Download <a href="${talk.mp3_url}" target="_blank" download="${talk.filename}">"${talk.title}" by ${talk.speaker} ⬇️</a></h6>`;

       return talk;
   }

   async function fetchMp3Link(talkUrl) {
       // page
       let page = await window.fetch(talkUrl);

       // get page with links
       let html = await page.text();

       // Un-react-ify the page data
       let m = html.match(/window.__INITIAL_STATE__ = "([^"]+)"/);
       let json = atob(m[1]);

       //let data = JSON.parse(json);
       //let links = json.match(/("https:[^"]+cdn[^"]+")/g);

       let mp3Match = json.match(/("https:[^"]*cdn[^"]*[^"]*mp3[^"]*")/g);
       let mp3Url;
       if (mp3Match && mp3Match[0]) {
           mp3Url = JSON.parse(mp3Match[0]);
       }

       return mp3Url;
   }

   function parseTitle($card) {
       return $("h4", $card).innerText.trim();
   }

   function parseSpeaker($card) {
       return $("h6", $card).innerText.trim();
   }

   function parseDescription($card) {
       return $(".description", $card).innerText.trim();
   }

   function parseNameByIndex(talk, index) {
       let url = new URL(talk.mp3_url);
       let filename = url.pathname.split("/").pop();
       let name = `${index}-${filename}`;
       return name;
   }

   async function scrapeTalks($$talks) {
       let talks = [];

       await $$talks.reduce(async function (p, $talk) {
           await p;

           let talk = await getTalk($talk, talks.length);
           if (!talk) {
               return;
           }
           talks.push(talk);

           console.log(`Found "${talk.title}" by ${talk.speaker}`);

           $talk.children[0].remove();
           $talk.insertAdjacentHTML("beforeend", talk.html);
       }, Promise.resolve());

       return talks;
   }

   async function main() {
       let $$sessions = [];
       let $$talks = [];

       let $$cards = $$("nav ul.doc-map ul.doc-map li a");

       $$cards = Array.prototype.slice.apply($$cards);

       console.log(await getTalk($$cards[2], 2));

       $$cards.forEach(function ($card) {
           let title = parseTitle($card);

           if (title.endsWith("Session")) {
               $$sessions.push($card);
           } else {
               $$talks.push($card);
           }
       });

       scrapeTalks($$talks).then(function (talks) {
           console.log("Done with Talks");
           console.log(
               talks
                   .map(function (t) {
                       return t.curl;
                   })
                   .join("\n")
           );
       });
   }

   main().catch(function (err) {
       console.error("Error:");
       console.error(err);
   });
   ```
4. Copy and paste the curl commands into Terminal.app
5. Use AudioBookBinder from the App store to convert from mp3 into m4b

Enjoy with **Bound** (via its Web Uploader) on iOS, or any other audiobook app on any other device.
