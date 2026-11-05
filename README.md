# souvenir

**Your camera roll, sorted into trips.** Drop in a folder of photos and videos and get them back as trips (with the city names already written on), plus everyday life month by month, screenshots in their own pile, and anything without a date set aside.

Everything runs in your browser. Your photos are only uploaded if you choose to share a trip, and then only to your own Google Drive or the app you pick.

**Try it: <https://anacrewator.github.io/souvenir/>**

## What it does

- **Opens iPhone HEIC photos in any browser**: Chrome, Edge and Firefox can't show HEIC on their own, so the app decodes them with [libheif](https://github.com/strukturag/libheif) (through `heic-to`), in a background worker, only when it finds one.
- **Reads the date and place inside each file**: photo EXIF (JPG, HEIC, PNG, WebP and more), video metadata (MP4 and MOV, including iPhone and Android location), Google Takeout's `.json` files, and dates in file names like `IMG_20240815_…` or WhatsApp's `IMG-20240815-WA0001`.
- **Works out where home is**: the place you took photos on the most days. Photos far from home and close together in time become a trip. Photos without GPS join a trip when the photos around them are on it.
- **Names trips**: "Lisbon", "Tokyo & Kyoto", with flags, a map and a day-by-day view.
- **No GPS at all?** It still guesses trips from runs of days with lots of photos, and marks them as guesses.
- **Watch it sort**: your photos land in a messy heap while they are read, then fly into a pile per trip, with the city names popping in as places are found. Skipped for people who turn off animations.
- **Rename** any trip. Names are remembered on your device.
- **Save** everything as real folders (`Trips/2026-06 Lisbon/…`, `Everyday/2026-03 March/…`) straight to your computer in Chrome or Edge, or download a ZIP in any browser.
- **Share a trip with friends**: upload it to a folder in your own Google Drive and get a link anyone can open and download from, or send the files straight from your phone (WhatsApp, AirDrop, Messages). The location is taken out of the files first, unless you untick it.
- **Story card**: a 1080×1920 scrapbook image of a trip, ready for Instagram. On phones it opens the share sheet.
- **Settings** for what counts as home, how far away counts as a trip, how long a gap ends a trip, and the smallest trip size.

## Getting your photos in

| From | How |
| --- | --- |
| Folders on your computer | Click **Choose a folder**, then **Add another folder** as many times as you like, and **Sort** them all together. Or drag several folders onto the page at once. |
| Google Photos | Export with [Google Takeout](https://takeout.google.com/settings/takeout/custom/photos), unzip, choose the folder. Takeout includes dates and places. |
| iPhone, on a Mac | In Photos: select all, then File › Export › **Export Unmodified Originals**. Choose that folder. |
| iPhone or Android, on the phone | Tap **Choose photos**. On iPhone, if you see **Options**, turn on **Location**, or the phone strips it. |

## Put it online with GitHub Pages (free)

1. Create a repository on GitHub and upload these files (or push this folder).
2. In the repo: **Settings › Pages**, set *Source* to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute your site is at `https://<your-username>.github.io/<repo-name>/`. That's the link to share with your followers.
4. Edit [`config.js`](config.js) to add your handle, the repo link and the site link (it gets printed on story cards).

There's no build step: it's plain HTML, CSS and JavaScript. To try it on your own computer, run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## Turn on Google Drive sharing

The **Share with friends** button always offers sending from the phone. The **Google Drive link** option shows up once you add a Google client ID. It takes about ten minutes, once:

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example "souvenir").
2. **APIs & Services › Library**: enable the **Google Drive API**.
3. **Google Auth Platform › Branding** (the old "OAuth consent screen"): app name, your email, and as privacy policy the link to this README's Privacy section. **Audience**: External.
4. **Data Access**: add the scope `https://www.googleapis.com/auth/drive.file`. It only lets the page see the files it creates itself, never the rest of anyone's Drive. Google lists it as non-sensitive, so it shouldn't need Google's long app review.
5. **Clients › Create client › Web application**. Under *Authorized JavaScript origins* add `https://<your-username>.github.io` (and `http://localhost:8000` to test on your computer). No redirect URI is needed.
6. Copy the **client ID** (it ends in `.apps.googleusercontent.com`) into `config.js` as `googleClientId`. A client ID is public, so it's fine in the repo. Never put a client *secret* here; this app doesn't use one.
7. While the app is in **Testing**, only the Google accounts you add as test users can sign in. To let your followers use it, press **Publish app** in *Audience*.

### Google Photos picker (optional)

With the same client ID you can also show **Pick from Google Photos**: enable the **Google Photos Picker API**, add the scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`, and set `googlePhotosPicker: true` in `config.js`. Google's picker gives dates but **not locations**, so these photos get sorted by date only. Takeout gives better trips. This scope is sensitive, so opening it to everyone needs Google's review.

## Privacy

- Photos and videos are read and sorted on your device.
- To name trips, the app sends the **rough centre of each trip** (rounded to about 1 km) to [BigDataCloud](https://www.bigdatacloud.com/)'s free reverse-geocoding service. You can switch this off in Settings, and trips will be named by month instead.
- The trip map loads tiles from OpenStreetMap, which sees which map area is being viewed.
- Names, settings and looked-up places are saved in your browser's local storage. Nothing else is kept.
- **Sharing is the only time files leave your device**, and only when you press the button:
  - *Google Drive link*: copies of that trip's files go straight from your browser to a new folder in **your own** Google Drive. The folder is set to "anyone with the link can view", so anyone you give the link to (or who it gets forwarded to) can see and download them. To stop sharing, delete the folder in Drive or change its sharing there.
  - *Send from this device*: the files go to the app you pick in the share menu.
  - With **Remove the location** ticked (the default), the GPS position is blanked out of each copy before it's sent (photo EXIF and XMP, video location tags). Each copy is checked afterwards, and any file that still has a location is left out and reported. Your original files aren't changed.
- If you turn on the Google Photos picker, the sign-in and downloads go straight between your browser and Google.

## Security

- **Hosting**: a static site on GitHub Pages. No server, database or open ports of our own. GitHub serves it over HTTPS.
- **Outside services the page talks to**: jsDelivr (EXIF reader, and the HEIC decoder when there are HEIC photos), cdnjs (ZIP and map libraries), Google Fonts, BigDataCloud (place names, can be turned off), OpenStreetMap tiles. Only when you share to Drive: Google sign-in (`accounts.google.com`) and the Drive API (`www.googleapis.com`). Only if you turn on the picker: Google Photos.
- **Google access**: the page asks for `drive.file` only, which covers the files it creates and nothing else in your Drive. The sign-in token lives in the page's memory for up to an hour and is never saved. Remove access any time at <https://myaccount.google.com/permissions>.
- **Secrets**: none. `config.js` only holds public values. Don't add API secrets to this repo.
- **How to check**: open the browser's developer tools › Network tab while sorting. You'll see no uploads of your files, only the requests listed above.

## Files

```
index.html          the page
config.js           your name, links, Google client ID for Drive sharing
css/styles.css      the scrapbook look
js/app.js           screens and buttons
js/metadata.js      reads dates and places from photos, videos and Takeout files
js/cluster.js       finds home, trips and months
js/geocode.js       turns coordinates into city names
js/thumbs.js        previews and the photo viewer
js/export.js        save as folders or ZIP
js/story.js         the story card
js/google-auth.js   Google sign-in (Google Identity Services)
js/drive.js         share a trip as a Google Drive folder
js/strip-location.js removes the location from copies before sharing
js/google-photos.js optional Google Photos picker
js/sort-show.js     the sorting animation (messy heap → piles)
js/demo.js          the sample camera roll
```

## License

MIT. Make it yours.
