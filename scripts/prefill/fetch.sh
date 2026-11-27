#!/bin/bash
# Downloads one prefill video (1080p, video only) to a directory outside the repo.
# Footage is copyrighted and large: never commit it, and delete it once extract.mts is done.
# Use a playthrough with English subtitles on and speaker names off.
#
# Usage: bash scripts/prefill/fetch.sh <dir> <name> <youtube id> <yt-dlp format>
#
# Then: pnpm dlx tsx scripts/prefill/extract.mts <dir>/<name>.webm <name> <dir>/out
#       pnpm dlx tsx scripts/prefill/build-lines.mts scripts/prefill/lines.jsonl <dir>/out/<name>.jsonl...
#
# Uses aria2c (from PyPI through uvx) with parallel connections: a single connection is throttled to ~3 MB/s.
set -eu
DIR="$1"
NAME="$2"
ID="$3"
FORMAT="$4"
mkdir -p "$DIR"
ARIA=$(uvx --from aria2 python -c "import shutil;print(shutil.which('aria2c'))")
uvx --from "yt-dlp[default]@latest" yt-dlp -q --no-warnings -f "$FORMAT" \
  --downloader "$ARIA" --downloader-args "aria2c:-x 16 -s 16 -k 4M --console-log-level=warn --summary-interval=0" \
  -o "$DIR/$NAME.%(ext)s" "https://www.youtube.com/watch?v=$ID"
ls -la "$DIR"
