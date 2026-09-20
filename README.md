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

## Web
Serve `web/` from any static host, or `python3 -m http.server --directory web`.
Photos save as PNG. Videos re-render in real time and save as WebM (MP4 on Safari); audio is kept.
Formats are whatever the browser can decode (JPG/PNG/WebP/GIF, MP4/WebM/MOV...). HEIC/MKV/AVI: use the CLI.

## CLI (handles practically every format via ffmpeg)
```bash
cd cli && npm install
node bin/pixelator.js                      # interactive: drag a file/folder in, pick options with arrow keys
node bin/pixelator.js photo.heic -s 12 -p pico8
node bin/pixelator.js ./holiday/ -s 8 -p gameboy -d none -o ./out
```
Palettes: original, auto8/16/32, gameboy, pico8, c64, cga, mono, sunset. Images -> PNG, GIF -> GIF, video -> MP4 (audio kept).
ffmpeg is bundled through `ffmpeg-static`; a system `ffmpeg` is the fallback.

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

## Icons
`node tools/make-icons.js` regenerates every icon and the Android splash (web, desktop, all Android densities) from one pixel-art invader. No dependencies.

## Signing
- **macOS:** ad-hoc signed by `desktop/adhoc-sign.js` (an electron-builder `afterSign` hook running `codesign --sign -`). It is not notarized, so the first launch needs right-click > Open.
- **Android:** `android/sign-release.sh` signs with a self-signed key. The keystore is created once in `../pixelator-signing/` (outside the repo, git-ignored). Keep it: Android only installs updates signed with the same key. Switching from the debug build to this one needs an uninstall first.
- **Windows:** unsigned. Windows has no ad-hoc mode; SmartScreen will warn (More info > Run anyway). Building on macOS also cannot embed the icon into the installed `.exe`.

## Notes
- On exFAT drives macOS writes `._*` files that break Gradle/electron-builder. Build from a copy on an internal disk (`rsync -a --exclude='._*'`).
