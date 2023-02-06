# Download General Conference <br> (and convert to Audiobook)

**Updated** for the April 2022 General Conference

How to convert the official General Conference website listing into an \
unofficial Audiobook for easy listening on any device, in any app.

## Download from ChurchOfJesusChrist.org

https://newsroom.churchofjesuschrist.org/article/october-2022-general-conference-news-announcements

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
   <img width="848" alt="Screenshot 2023-02-06 at 6 12 23 AM" src="https://user-images.githubusercontent.com/122831/216980391-d62e62cc-31b1-4540-b4d3-349d4f4437c0.png">
4. Download each talk by either:
     - Painstakingly download each talk with the provided links
     - Or copy and paste the `curl` commands into `Terminal.app`

## Convert to AudioBook

1. Use **AudioBookBinder** from the ***App Store*** to convert from several `mp3`s into a single `m4b`
   <img width="612" alt="Screenshot 2023-02-06 at 6 03 25 AM" src="https://user-images.githubusercontent.com/122831/216980303-9dc90374-42e1-4d6d-be5f-c7ffa98d9065.png">
   <img width="612" alt="Screenshot 2023-02-06 at 6 06 35 AM" src="https://user-images.githubusercontent.com/122831/216980326-dc2a5f5c-0f29-4abb-9d31-378ca32d5376.png">
   <img width="612" alt="Screenshot 2023-02-06 at 6 10 00 AM" src="https://user-images.githubusercontent.com/122831/216980360-f71d9136-4ea5-49c4-b715-66072d7398f5.png">
2. Check the Church Newsroom if you'd like a nice image to use: \
   <https://newsroom.churchofjesuschrist.org/article/october-2022-general-conference-news-announcements>
   <img width="1211" alt="Screenshot 2023-02-06 at 6 14 13 AM" src="https://user-images.githubusercontent.com/122831/216980624-e850101d-5208-4248-8c0b-be0051d2393f.png">
3. Enjoy with **Bound** (via its Web Uploader) on iOS, or any other audiobook app on any other device
