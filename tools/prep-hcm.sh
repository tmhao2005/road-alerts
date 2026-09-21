#!/bin/sh
# Build the TP.HCM test data from Geofabrik's Vietnam extract. Everything lands in data/,
# which is git-ignored: OSM extracts must never enter history.
#
# Needs osmium-tool (brew install osmium-tool). Set PBF to reuse an extract already on disk.
set -e
cd "$(dirname "$0")/.."
mkdir -p data

PBF=${PBF:-data/vietnam-latest.osm.pbf}

# A header-only check passes on a truncated file, so read the whole thing. A dropped
# connection otherwise leaves a file that looks present and fails later with
# "unexpected EOF".
if [ -f "$PBF" ] && ! osmium fileinfo -e "$PBF" >/dev/null 2>&1; then
  echo "Existing $PBF is incomplete; downloading again."
  rm -f "$PBF"
fi

if [ ! -f "$PBF" ]; then
  echo "Downloading Vietnam extract (~315 MB)..."
  # Write to .part and rename only on success, so an interrupted download never
  # masquerades as a finished one. -C - resumes a .part left by an earlier attempt.
  curl -fL -C - -o "$PBF.part" https://download.geofabrik.de/asia/vietnam-latest.osm.pbf
  mv "$PBF.part" "$PBF"
fi

# TP.HCM plus enough margin to cover the quốc lộ leaving it (QL1A, QL13, QL22, QL51),
# because the out-of-town run is where the đông dân cư guess actually gets tested.
BBOX=106.30,10.40,107.10,11.25

osmium extract -s smart -b "$BBOX" "$PBF" -o data/hcm.osm.pbf --overwrite
osmium tags-filter data/hcm.osm.pbf \
  w/highway w/landuse=residential r/landuse=residential r/boundary=administrative \
  -o data/hcm-filtered.osm.pbf --overwrite
osmium export data/hcm-filtered.osm.pbf -c tools/export-config.json \
  -f geojsonseq -o data/hcm.geojsonseq --overwrite
node tools/build-index.js data/hcm.geojsonseq data/hcm-index.json "$BBOX"
