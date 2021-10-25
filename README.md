# General-Conference-to-Audiobook

Convert the official General Conference website listing into an unofficial Audiobook for easy listening on any device, in any app.

1. Go to any of the General Conference listings, such as:
  - https://www.churchofjesuschrist.org/study/general-conference/2021/10
  - https://www.churchofjesuschrist.org/study/general-conference/2021/04
2. Open Chrome's Menu => More Tools => Developer Tools (the JavaScript Console Inspector)
3. Copy and Paste this into the Console:
   ```js
   var talks = [];

   async function scrapeTalk($li) {
       // var $li = $$li[0];
       var $a = $li.querySelector("a");
       var $speaker = $li.querySelector("h6");
       if (!$a || !$speaker) {
           return;
       }

       var title = $li.querySelector("h4").innerText.trim();
       var speaker = $speaker.innerText.trim();
       var description = $li.querySelector(".description").innerText.trim();
       var url = $a.href;
       var page = await window.fetch(url);
       var html = await page.text();
       var m = html.match(/href=("[^"]+ldscdn[^"]+")/);
       var dl;

       if (m && m[1]) {
           dl = JSON.parse(m[1]);
       }
       var talk = {
           title: title,
           speaker: speaker,
           description: description,
           mp3_url: dl,
       };
       return talk;
   }

   async function scrapeTalks($$li) {
       await $$li.reduce(async function (p, $li) {
           await p;

           var talk = await scrapeTalk($li);
           $li.children[0].remove();
           if (!talk) {
               return;
           }

           var index = (1 + talks.length).toString().padStart(3, "0");
           var url = new URL(talk.mp3_url);
           var filename = url.pathname.split("/").pop();
           var name = `${index}-${filename}`;

           talk.curl = `curl -fL -A 'TheOne/1.0' -o "${name}" '${talk.mp3_url}'`;
           talks.push(talk);
           $li.insertAdjacentHTML(
               "beforeend",
               `
         <h6 style="font-size: 8pt;">${talks.length}. Download <a href="${talk.mp3_url}" target="_blank" download="${name}">"${talk.title}" by ${talk.speaker} ⬇️</a></h6>
       `
           );
           console.log(`Found "${talk.title}" by ${talk.speaker}`);
       }, Promise.resolve());

       return talks;
   }

   async function main() {
       var $$li = $$(".doc-map li");
       var $$sessions = [];
       var $$talks = [];
       Array.prototype.slice.apply($$li).forEach(function ($li) {
           if ($li.innerText.match(/ Session\b/)) {
               $$sessions.push($li);
           } else {
               $$talks.push($li);
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
       /*
       scrapeTalks($$sessions).then(function () {
           console.log("Done with Sessions");
       })
       */
   }
   main().catch(function (err) {
       console.error("Error:");
       console.error(err);
   });
   ```
4. Copy and paste the curl commands into Terminal.app
5. Use AudioBookBinder from the App store to convert from mp3 into m4b

Enjoy with **Bound** (via its Web Uploader) on iOS, or any other audiobook app on any other device.
