#!/bin/bash
# Downloads gameplay footage (1080p, video only) for the OCR benchmark. Footage is copyrighted: keep it out of git.
# Usage: bash scripts/ocr-bench/fetch.sh <dir> <name> <video url> [start-end, e.g. 00:00:30-00:08:30]
set -eu
DIR="$1"
NAME="$2"
URL="$3"
RANGE="${4:-}"
mkdir -p "$DIR"
if [ -n "$RANGE" ]; then
  uvx --from "yt-dlp[default]@latest" yt-dlp -q -f "bv*[height<=1080][ext=mp4]" --download-sections "*$RANGE" -o "$DIR/$NAME.%(ext)s" "$URL"
else
  uvx --from "yt-dlp[default]@latest" yt-dlp -q -f "bv*[height<=1080][ext=mp4]" -o "$DIR/$NAME.%(ext)s" "$URL"
fi
ls -la "$DIR"
