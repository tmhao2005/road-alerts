# Data feasibility spike — results

Run 2026-09-21 against `vietnam-latest.osm.pbf` (Geofabrik, 313 MB, replication timestamp
2026-09-19T20:22:34Z). Tooling: osmium-tool 1.19.1. Scripts and raw output are not committed;
they are throwaway and the numbers below are the deliverable.

## The five numbers

### 1. Explicit `maxspeed` coverage, by road class

Kilometres are OSM way-centreline kilometres. Divided roads carry one way per direction, so
these are larger than route length — the ratios are the point, not the absolute totals.

| Class | km | ways | km with `maxspeed` | **coverage** |
|---|---:|---:|---:|---:|
| cao tốc | 7,701 | 10,253 | 6,858 | **89.0%** |
| quốc lộ | 40,892 | 52,725 | 8,331 | **20.4%** |
| tỉnh lộ | 32,470 | 37,153 | 2,463 | **7.6%** |
| urban street (tertiary/unclassified) | 132,524 | 134,123 | 1,656 | **1.2%** |
| residential | 376,207 | 1,679,032 | 1,587 | **0.4%** |
| other drivable (service/track/road) | 71,267 | 858,680 | 151 | **0.2%** |
| **total** | **661,061** | **2,771,966** | **21,045** | **3.2%** |

Implicit tagging — `maxspeed:type`, `source:maxspeed`, `zone:maxspeed` — is effectively
absent: 0.9% of quốc lộ km, under 0.5% everywhere else. Nobody has encoded the statutory
defaults into OSM, so there is nothing to inherit and nothing to conflict with.

Where a number does exist it is a sane one: cao tốc clusters on 90/100/120/80, quốc lộ on
80/60/50, urban on 50/60/40.

### 2. Đông dân cư boundary coverage

**17 usable nodes in the entire country.** 16 tagged `traffic_sign=city_limit`, 1 tagged
`VN:R.420`. For scale, all of Vietnam has 794 nodes with any `traffic_sign` tag at all, and
638 of those are the useless value `yes`.

This is a zero. The fallback is load-bearing, exactly as the brief suspected. What is
available to build it from:

| Fallback signal | Count |
|---|---:|
| `landuse=residential` ways / relations | 11,825 / 194 |
| `place=village` / `hamlet` nodes | 9,225 / 3,267 |
| `place=town` / `city` nodes | 1,256 / 139 |
| `admin_level=6` relations (commune/ward, post-2025 two-tier reform) | 3,396 |

### 3. Speed camera nodes

**43 `highway=speed_camera` nodes nationwide.** Separately, 294 `man_made=surveillance`
nodes, of which **zero** carry any speed-enforcement subtag, and 2 nodes with `enforcement=*`.

The camera layer does not exist. Of the 43, 25 were last touched in 2026 and 16 in 2024, so
what little there is, is recent — but 43 points is not a product.

### 4. Offline bundle size

Quantised to ~1.1 m, delta-encoded varint geometry, plus class + speed + confidence byte per
way. OSM metadata dropped. Actual bytes written, not an estimate.

| Tier | ways | raw | **gzip** |
|---|---:|---:|---:|
| trunk (cao tốc + quốc lộ + tỉnh lộ) | 100,131 | 5.3 MB | **4.4 MB** |
| alerting (trunk + urban + residential) | 1,913,286 | 70.3 MB | **53.8 MB** |
| all drivable | 2,771,966 | 88.1 MB | **66.6 MB** |

For reference, the naive approach — `osmium tags-filter` to drivable ways, all tags and
metadata retained — is 199.7 MB.

### 5. Freshness

Share of each class's `maxspeed`-tagged kilometres by year of last edit:

| Class | ≤2018 | 2019–21 | 2022–23 | 2024 | 2025 | 2026 | median |
|---|---:|---:|---:|---:|---:|---:|---:|
| cao tốc | 0.0% | 0.0% | 1.2% | 4.0% | 25.6% | 69.2% | **2026** |
| quốc lộ | 0.0% | 0.2% | 4.6% | 11.8% | 29.9% | 53.4% | **2026** |
| tỉnh lộ | 0.0% | 0.6% | 3.5% | 10.7% | 23.8% | 61.4% | **2026** |
| urban street | 0.2% | 2.8% | 6.0% | 11.8% | 25.6% | 53.6% | **2026** |
| residential | 0.2% | 7.2% | 18.2% | 25.5% | 18.3% | 30.7% | **2024** |
| *(all roads, tagged or not)* | *2.0%* | *60.2%* | *6.4%* | *6.0%* | *8.4%* | *17.0%* | |

This is the one number that came back better than expected, and the contrast in the last row
is the tell. The road network as a whole was mass-imported around 2019–21 and left alone.
The `maxspeed` tags are not part of that sediment — they are recent, hand-made edits, 95% of
cao tốc tagged km touched in 2024 or later. The coverage is thin but it is not rotting.

## What this implies for the architecture

It is a data collection problem, and the statutory function is the product. At 3.2% national
coverage — 0.4% on the residential streets where most driving minutes are actually spent —
OSM cannot be the primary source for speed limits; it is a correction layer, which is the
shape priority 3 already assumed and this confirms rather than discovers. The two genuine
findings are the zeroes. First, đông dân cư boundaries are absent (17 nodes), so the one
input the statutory function cannot derive for itself has to be *inferred* — from
`landuse=residential` polygons, `place` nodes and commune boundaries — and that inference is
now a core component with its own confidence, not a fallback bolted on later. It is the
riskiest thing in the project, because getting the side of the boundary wrong changes the
answer by 20–30 km/h and it will be wrong silently. Second, cameras are absent (43 nodes),
so the feature most likely to drive payment is crowdsourced from day one, with nothing to
seed it — that is a cold-start problem to plan around, not a data import. The one piece of
good news is that the thin data is fresh, which means corroborating against OSM is worth
doing where it exists rather than being noise. On packaging, offline-first is settled: the
trunk network fits in **4.4 MB** and the full alerting network in **54 MB**, so there is no
case for a tile server at launch — ship the trunk tier in the binary, which covers precisely
the cao tốc and quốc lộ stretches where enforcement is heaviest and connectivity is worst.
Finally, the ODbL separation in priority 4 gets easier, not harder: with 96.8% of limits
computed from statute rather than derived from OSM, our database is overwhelmingly our own,
and OSM stays a thin, separable, join-at-query-time correction table.

## Caveats

- Road class is inferred from the OSM `highway` tag plus `ref` prefix (`CT*`, `QL*`,
  `ĐT|DT|TL*`). Ways tagged `construction` or `proposed` are excluded regardless of `ref` —
  an early version of the script did not exclude them and inflated cao tốc by 45%.
- "Explicit coverage" counts any numeric `maxspeed`, `maxspeed:forward` or `maxspeed:backward`.
  Values of `none`/`signals`/`variable` are not counted.
- Freshness is the way's last edit of *any* tag, not of the `maxspeed` tag specifically. OSM
  history does not carry per-tag timestamps without a full-history extract, so this is an
  upper bound on how fresh a given limit is.
- None of this says whether the data is *correct* on the actual road. That is the separate
  three-route ground check the brief scopes out, and it still needs Hao to name the routes.
