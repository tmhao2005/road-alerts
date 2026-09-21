#!/bin/sh
# Assemble the test app into site/: the page, the rule modules it imports, and the map
# tiles. site/ is git-ignored; GitHub Actions rebuilds it on every push to main.
set -e
cd "$(dirname "$0")/.."

[ -f data/hcm-index.json ] || sh tools/prep-hcm.sh

rm -rf site
mkdir -p site/src
cp web/index.html web/app.js web/style.css site/
# Only the runtime modules - tests stay out of the published site.
for f in geo limit zone lookup live; do cp "src/$f.js" site/src/; done
node tools/build-tiles.js data/hcm-index.json site/tiles
