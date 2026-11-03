# souvenir

**Your camera roll, sorted into trips.** Drop in a folder of photos and videos and get them back as trips (with the city names already written on), plus everyday life month by month, screenshots in their own pile, and anything without a date set aside.

Everything runs in your browser. Your photos are never uploaded.

**Try it: <https://anacrewator.github.io/souvenir/>**

## What it does

- **Reads the date and place inside each file**: photo EXIF (JPG, HEIC, PNG, WebP and more), video metadata (MP4 and MOV, including iPhone and Android location), Google Takeout's `.json` files, and dates in file names like `IMG_20240815_…` or WhatsApp's `IMG-20240815-WA0001`.
- **Works out where home is**: the place you took photos on the most days. Photos far from home and close together in time become a trip. Photos without GPS join a trip when the photos around them are on it.
- **Names trips**: "Lisbon", "Tokyo & Kyoto", with flags, a map and a day-by-day view.
- **No GPS at all?** It still guesses trips from runs of days with lots of photos, and marks them as guesses.
- **Rename** any trip. Names are remembered on your device.
- **Save** everything as real folders (`Trips/2026-06 Lisbon/…`, `Everyday/2026-03 March/…`) straight to your computer in Chrome or Edge, or download a ZIP in any browser.
- **Story card**: a 1080×1920 scrapbook image of a trip, ready for Instagram. On phones it opens the share sheet.
- **Settings** for what counts as home, how far away counts as a trip, how long a gap ends a trip, and the smallest trip size.

## Getting your photos in

| From | How |
| --- | --- |
| A folder on your computer | Click **Choose a folder**, or drag the folder onto the page. |
| Google Photos | Export with [Google Takeout](https://takeout.google.com/settings/takeout/custom/photos), unzip, choose the folder. Takeout includes dates and places. |
| iPhone, on a Mac | In Photos: select all, then File › Export › **Export Unmodified Originals**. Choose that folder. |
| iPhone or Android, on the phone | Tap **Choose photos**. On iPhone, if you see **Options**, turn on **Location**, or the phone strips it. |

## Put it online with GitHub Pages (free)

1. Create a repository on GitHub and upload these files (or push this folder).
2. In the repo: **Settings › Pages**, set *Source* to **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute your site is at `https://<your-username>.github.io/<repo-name>/`. That's the link to share with your followers.
4. Edit [`config.js`](config.js) to add your handle, the repo link and the site link (it gets printed on story cards).

There's no build step: it's plain HTML, CSS and JavaScript. To try it on your own computer, run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## Turn on the Google Photos picker (optional)

The **Pick from Google Photos** button stays hidden until you add a Google client ID. Google's picker gives dates but **not locations**, so these photos get sorted by date only. Takeout gives better trips.

1. Go to [Google Cloud Console](https://console.cloud.google.com/), create a project, and enable the **Google Photos Picker API**.
2. Set up the **OAuth consent screen** (External). Add the scope `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
3. Create **Credentials › OAuth client ID › Web application**. Under *Authorized JavaScript origins*, add your Pages address (`https://<your-username>.github.io`) and `http://localhost:8000` for testing.
4. Put the client ID in `config.js` as `googleClientId`. A client ID is public, so it's fine in the repo. Never put a client *secret* here.

While the consent screen is in "Testing", only the Google accounts you list as test users can sign in. To open it to all your followers, you have to send the app to Google for verification.

## Privacy

- Photos and videos are read on your device. They're never uploaded.
- To name trips, the app sends the **rough centre of each trip** (rounded to about 1 km) to [BigDataCloud](https://www.bigdatacloud.com/)'s free reverse-geocoding service. You can switch this off in Settings, and trips will be named by month instead.
- The trip map loads tiles from OpenStreetMap, which sees which map area is being viewed.
- Names, settings and looked-up places are saved in your browser's local storage. Nothing else is kept.
- If you turn on the Google picker, the sign-in and downloads go straight between your browser and Google.

## Security

- **Hosting**: a static site on GitHub Pages. No server, database or open ports of our own. GitHub serves it over HTTPS.
- **Outside services the page talks to**: jsDelivr (EXIF reader), cdnjs (ZIP and map libraries), Google Fonts, BigDataCloud (place names, can be turned off), OpenStreetMap tiles, and Google sign-in/Photos only if you turn on the picker.
- **Secrets**: none. `config.js` only holds public values. Don't add API secrets to this repo.
- **How to check**: open the browser's developer tools › Network tab while sorting. You'll see no uploads of your files, only the requests listed above.

## Files

```
index.html          the page
config.js           your name, links, optional Google client ID
css/styles.css      the scrapbook look
js/app.js           screens and buttons
js/metadata.js      reads dates and places from photos, videos and Takeout files
js/cluster.js       finds home, trips and months
js/geocode.js       turns coordinates into city names
js/thumbs.js        previews and the photo viewer
js/export.js        save as folders or ZIP
js/story.js         the story card
js/google-photos.js optional Google Photos picker
js/demo.js          the sample camera roll
```

## License

MIT. Make it yours.
