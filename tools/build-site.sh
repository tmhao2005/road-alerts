#!/bin/sh
# Assemble the test app into site/: the page, the rule modules it imports, and the map
# tiles. site/ is git-ignored; GitHub Actions rebuilds it on every push to main.
set -e
cd "$(dirname "$0")/.."

[ -f data/hcm-index.json ] || sh tools/prep-hcm.sh

# The page is replaced every time; the tiles only when the map data is newer than them,
# so changing the page locally takes a second rather than a rebuild of every tile.
rm -rf site/src site/voice site/*.html site/*.js site/*.css site/*.webmanifest site/*.png site/*.svg
mkdir -p site/src
cp web/*.html web/*.js web/*.css web/*.webmanifest web/*.png web/*.svg site/
# The spoken lines. Committed rather than rendered here, since CI has no API key - see
# tools/render-voice.js. Only the default voice is committed, so the manifest is trimmed to
# whatever actually arrived: all eight locally, one in CI. Otherwise a voice picker would
# offer voices whose clips are not deployed.
if [ -d web/voice ]; then
  cp -R web/voice site/voice
  node -e 'const fs=require("fs"),p="site/voice/manifest.json";if(fs.existsSync(p)){const m=JSON.parse(fs.readFileSync(p,"utf8"));m.voices=(m.voices||[]).filter(v=>fs.existsSync("site/voice/"+v.name));fs.writeFileSync(p,JSON.stringify(m,null,2)+"\n")}'
fi
# Only the runtime modules - tests stay out of the published site.
for f in src/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" site/src/ ;; esac
done
if [ ! -f site/tiles/index.json ] || [ data/hcm-index.json -nt site/tiles/index.json ]; then
  node tools/build-tiles.js data/hcm-index.json site/tiles
fi
# Routes for the demo drives that go somewhere (?demo=tamanh), over those tiles.
if [ ! -d site/demo ] || [ site/tiles/index.json -nt site/demo ] || [ tools/demo-route.js -nt site/demo ]; then
  node tools/demo-route.js site/tiles site/demo
  touch site/demo
fi
# A made-up trip on those tiles, for ?mock: the review, without driving.
if [ ! -f site/mock/trip.json ] || [ site/tiles/index.json -nt site/mock/trip.json ] || [ tools/mock-trip.js -nt site/mock/trip.json ]; then
  node tools/mock-trip.js site/tiles site/mock/trip.json
fi
