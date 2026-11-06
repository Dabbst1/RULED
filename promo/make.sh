#!/usr/bin/env bash
# Builds the Monerem promo video from scratch.
#   bash promo/make.sh           -> refilm the app screens, then render
#   bash promo/make.sh --reuse   -> keep the saved screens in promo/shots, just render
# Output: promo/out/Monerem-promo.mp4 (1080x1920, 30 fps, with music)
# Needs: python3, playwright + Chromium (or Chrome), ffmpeg, numpy, Pillow.
set -euo pipefail
cd "$(dirname "$0")"
PROMO="$(pwd)"; SITE_SRC="$(cd .. && pwd)"
CHROME="${CHROME:-/usr/bin/google-chrome}"
sed -i "s#executable_path=\"[^\"]*\"#executable_path=\"$CHROME\"#" cap.py render.py preview.py

if [ "${1:-}" != "--reuse" ]; then
  # film a local copy of the site in test mode (sample data, no real login or bank)
  SITE="$(mktemp -d)"; cp "$SITE_SRC"/*.html "$SITE_SRC"/*.js "$SITE_SRC"/*.json "$SITE_SRC"/*.png "$SITE_SRC"/*.svg "$SITE_SRC"/*.ico "$SITE"/ 2>/dev/null || true
  sed -i 's/devMode: false/devMode: true/' "$SITE/app.html"
  (cd "$SITE" && python3 -m http.server 8770 >/dev/null 2>&1) & SERVER=$!
  trap 'kill $SERVER 2>/dev/null || true' EXIT
  sleep 1
  mkdir -p shots shotsd
  python3 cap.py shots
  python3 cap.py shotsd dark
fi

TOTAL=$(python3 - <<'EOF'
import re
s=open("scenes.html").read()
print(round(sum(float(x) for x in re.findall(r"S\.\w+=\{d:([\d.]+)",s)),2))
EOF
)
python3 music.py "$TOTAL"
rm -rf parts && python3 render.py
mkdir -p out
ffmpeg -y -loglevel error -f concat -safe 0 -i parts/list.txt -c copy parts/joined.mp4
ffmpeg -y -loglevel error -i parts/joined.mp4 -i music.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart out/Monerem-promo.mp4
rm -rf parts music.wav
echo "Done: $PROMO/out/Monerem-promo.mp4"
