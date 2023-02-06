# Download General Conference <br> (and convert to Audiobook)

**Updated** for the April 2022 General Conference

How to convert the official General Conference website listing into an \
unofficial Audiobook for easy listening on any device, in any app.

## Download from ChurchOfJesusChrist.org

1. Go to any of the General Conference listings (from April 1971 to Present). **For example**:
   - https://www.churchofjesuschrist.org/study/general-conference/2021/10
   - https://www.churchofjesuschrist.org/study/general-conference/1971/04
2. Open Chrome's `Menu => More Tools => Developer Tools` (the JavaScript Console Inspector)
3. Copy and Paste this script into the Console:
   ```js
   var script = document.createElement('script');
   script.src="https://churchofjesuschristdev.github.io/General-Conference-to-Audiobook/general-conference-talks.js";
   document.body.append(script);
   ```
4. Download each talk by either:
     - Painstakingly download each talk with the provided links
     - Or copy and paste the `curl` commands into `Terminal.app`

## Convert to AudioBook

1. Use **AudioBookBinder** from the ***App Store*** to convert from several `mp3`s into a single `m4b`.
2. Enjoy with **Bound** (via its Web Uploader) on iOS, or any other audiobook app on any other device.
