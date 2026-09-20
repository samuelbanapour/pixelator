# Third-party notices

## heic2any (web/vendor/heic2any.min.js)
Decodes HEIC/HEIF photos (iPhone) in browsers that cannot. MIT licence, see `web/vendor/heic2any.LICENSE.md`.
It embeds **libheif** (LGPL-3.0, https://github.com/strukturag/libheif) compiled to JavaScript/WebAssembly. The file is
unmodified, is loaded as a separate script, and can be replaced by dropping in another build of heic2any at the same path.
Source: https://github.com/alexcorvi/heic2any and https://github.com/strukturag/libheif.

## ffmpeg-static (CLI, downloaded at install time)
Bundles FFmpeg (LGPL-2.1+/GPL depending on build), https://ffmpeg.org. Not redistributed in this repository.
