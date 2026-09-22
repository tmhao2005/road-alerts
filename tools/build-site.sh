#!/bin/sh
# Assemble the test app into site/: the page, the rule modules it imports, and the map
# tiles. site/ is git-ignored; GitHub Actions rebuilds it on every push to main.
set -e
cd "$(dirname "$0")/.."

[ -f data/hcm-index.json ] || sh tools/prep-hcm.sh

# The page is replaced every time; the tiles only when the map data is newer than them,
# so changing the page locally takes a second rather than a rebuild of every tile.
rm -rf site/src site/*.html site/*.js site/*.css site/*.webmanifest site/*.png site/*.svg
mkdir -p site/src
cp web/*.html web/*.js web/*.css web/*.webmanifest web/*.png web/*.svg site/
# Only the runtime modules - tests stay out of the published site.
for f in src/*.js; do
  case "$f" in *.test.js) ;; *) cp "$f" site/src/ ;; esac
done
if [ ! -f site/tiles/index.json ] || [ data/hcm-index.json -nt site/tiles/index.json ]; then
  node tools/build-tiles.js data/hcm-index.json site/tiles
fi
