# Pixelator

Turn any photo or video into pixel art. One shared engine, five front-ends.

| Platform | Folder | Output |
|---|---|---|
| Web | `web/` | static site (any host) |
| Android | `android/` | Capacitor project -> APK / AAB |
| Windows (x64 + ARM64) | `desktop/` | one NSIS installer covering both CPUs |
| macOS (Intel + Apple Silicon) | `desktop/` | universal `.dmg` / `.zip` |
| CLI (ASCII-art, interactive) | `cli/` | `pixelator` command, Node 18+ |

`web/` is the single source of truth. `desktop/` and `android/` copy it in (`sync.js`) at build time, so nothing drifts.

## Looks
Pick a **Look** and Pixelator sets the resolution, color depth, dithering and effects of an era in one go:

| Look | Grid (long side) | Color | Extras |
|---|---|---|---|
| VHS tape | 360 | full | chroma bleed, tape noise, faded blacks, scanlines, tracking glitches, PLAY / date on-screen text |
| PlayStation 1 (1994) | 320 | 15-bit, ordered dither | scanlines |
| PlayStation 2 (2000) | 640 | full | soft focus, light bloom, scanlines |
| Xbox (2001) | 640 | full | bloom, punchy contrast |
| Xbox 360 (2005) | 1280 | full | heavy bloom, desaturated brown grade, vignette |
| DOS VGA (1990) | 320 | 256 (3-3-2), dither | scanlines |
| DOS EGA (1984) | 320 | 16 fixed, dither | scanlines |
| Windows 95 (1995) | 640 | 216 web-safe, dither | |

In the apps, the sliders stay live after choosing a look (drag Pixel size to override its resolution; **Look strength** scales the effects). The look table lives in `web/pixelate.js`; the CLI gets a copy through `node cli/sync.js` (run it after editing `web/pixelate.js`). In the CLI, `-l vhs --strength 60`. CLI effects are ffmpeg approximations of the web ones: no tracking glitches or on-screen text, and bloom is a soft glow.

## Crop and sound
- **Crop** (photos and videos): press **Crop…**, drag the box or its handles, pick a shape (Free, Original, 1:1, 4:3, 3:2, 16:9, 9:16) and **Apply crop**. The pixelation is then computed on the cropped area and saved at that size. **Edit crop** / **Reset crop** change or remove it. Works with touch. CLI: `--crop 16:9` (centered) or `--crop x,y,w,h` in pixels.
- **Sound** (videos): the preview plays with sound (untick **Play sound in preview** to mute it). The **Volume** slider sets the preview and the level saved in the file: 100% keeps the original, 0% saves the video without sound. If the browser cannot capture the sound, you get a message instead of a silently mute file. The CLI always keeps the original audio.
- While a video is being saved, keep the window visible: browsers stop drawing hidden tabs. The web app pauses and resumes for you; the desktop app keeps going in the background.

## Web
Serve `web/` from any static host, or `python3 -m http.server --directory web`.
Photos save as PNG. Videos re-render in real time and save as WebM (MP4 on Safari); audio is kept.
Formats are whatever the browser can decode (JPG/PNG/WebP/GIF, MP4/WebM/MOV...). iPhone **HEIC/HEIF** photos are converted on the fly: by Android's own decoder in the Android app (`HeicConverterPlugin`), otherwise by a bundled JavaScript decoder (`web/vendor`, see `THIRD_PARTY_NOTICES.md`; it returns garbage on very old WebViews such as Android 9 tablets, which is why Android does not use it); MKV/AVI and other exotic video: use the CLI.

## CLI (handles practically every format via ffmpeg)
```bash
cd cli && npm install
node bin/pixelator.js                      # interactive: drag a file/folder in, pick options with arrow keys
node bin/pixelator.js photo.heic -s 12 -p pico8
node bin/pixelator.js clip.mov -l vhs           # or ps1, ps2, xbox, x360, dos, ega, win95
node bin/pixelator.js ./holiday/ -s 8 -p gameboy -d none -o ./out
```
Palettes: original, auto8/16/32, gameboy, pico8, c64, cga, ega, vga332, websafe, ps1, truecolor, mono, sunset. Images -> PNG, GIF -> GIF, video -> MP4 (audio kept).
ffmpeg is bundled through `ffmpeg-static`; a system `ffmpeg` is the fallback.
ffmpeg itself cannot open HEIC/HEIF/AVIF photos, so for those the CLI first converts with a tool the system already has: `sips` (built into macOS), ImageMagick (`magick`) or `heif-convert` (libheif). Windows/Linux without those: export the photo as JPG first.

## Desktop (Electron)
```bash
cd desktop && npm install
npm start                # run
npm run dist:mac         # universal dmg + zip (build on a Mac)
npm run dist:win         # x64 + ARM64 NSIS installer (works from a Mac, unsigned)
npm run dist             # both, one after the other
```

Run the mac and win builds as separate electron-builder invocations (that is all `dist` does). Passing `--mac --universal --win --x64 --arm64` in a single call applies the arch flags to both platforms and breaks the Windows step.

## Android (Capacitor)
```bash
cd android && npm install
npm run add              # first time only: generates android/android
npm run apk              # debug APK  (needs Android SDK + JDK 17)
./sign-release.sh        # release APK signed with a self-signed key (see Signing)
```
Saving on Android uses Capacitor Filesystem + Share (share sheet -> Photos, Files, etc.).
Set `sdk.dir` in `android/android/local.properties` and use JDK 17 (`JAVA_HOME`), not 25.

## Microsoft Store
`desktop/package.json` has an `appx` target (tiles are in `desktop/build/appx`, made by `tools/make-icons.js`). AppX cannot be built on a Mac without a Parallels Windows VM, so use the **Microsoft Store package** GitHub Actions workflow (Actions tab > Run workflow). Paste the three values from Partner Center > Product identity. It builds x64 and ARM64 `.appx` files; upload both in one Store submission. The identity values in `package.json` are placeholders, so a local build is not submittable.

## Icons
`node tools/make-icons.js` regenerates every icon and the Android splash (web, desktop, all Android densities) from one pixel-art invader. No dependencies.

## Signing
- **macOS:** ad-hoc signed by `desktop/adhoc-sign.js` (an electron-builder `afterSign` hook running `codesign --sign -`). It is not notarized, so the first launch needs right-click > Open.
- **Android:** `android/sign-release.sh` signs with a self-signed key. The keystore is created once in `../pixelator-signing/` (outside the repo, git-ignored). Keep it: Android only installs updates signed with the same key. Switching from the debug build to this one needs an uninstall first.
- **Windows:** unsigned. Windows has no ad-hoc mode; SmartScreen will warn (More info > Run anyway). Building on macOS also cannot embed the icon into the installed `.exe`.

## Notes
- On exFAT drives macOS writes `._*` files that break Gradle/electron-builder. Build from a copy on an internal disk (`rsync -a --exclude='._*'`).
