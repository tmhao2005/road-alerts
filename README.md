# Road Alerts

*Working title.*

A Vietnamese driving companion that tells you the legal speed limit on any road, by voice
and on a glanceable screen, and gets more accurate every trip as drivers correct it.

**Status: pre-code.** The data feasibility spike has run, the speed law has been read at
source, and there is a clickable design prototype. No app code yet. The next piece of work
is the statutory speed function (see [Next steps](#next-steps)).

---

## Try it

Check the speed limit at any point in TP.HCM by pasting a coordinate from Google Maps
(right-click the map, click the coordinates to copy them):

```sh
brew install osmium-tool   # once
npm run prep               # once: downloads the Vietnam extract, builds data/ (~2 min)
npm test                   # the law's tables, as tests

npm run check -- "10.7743, 106.7010"                 # a car, by default
npm run check -- "10.7743, 106.7010" --xe xe_mo_to   # another vehicle
npm run check -- "10.7743, 106.7010" --tat-ca        # every vehicle at once
```

It prints the matched road, the ward or commune, the đông dân cư guess with its reason
and confidence, the limit with the rule that produced it, and every assumption made on
the way. The reasons are the point: when it's wrong, they show why.

---

## Where things are

| | |
|---|---|
| [`docs/spike-brief.md`](docs/spike-brief.md) | What the data spike set out to answer |
| [`docs/spike-results.md`](docs/spike-results.md) | The five spike numbers and what they imply |
| This README | Everything learned since: the law, competitors, platforms, design |
| [Design prototype](https://claude.ai/artifact/H5trR8fNJBfzKPX4e5CpoS) | Interactive HUD boards. Private until shared from the page's Share menu |
| [`CLAUDE.md`](CLAUDE.md) | Early thinking and working conventions. Treat as ideas, not settled decisions |

---

## The one-paragraph version

Open map data is too thin to be the source of speed limits (3.2% of Vietnam's road
kilometres carry one), so **the limit is computed from the law** — Thông tư 38/2024 sets it
from road class, vehicle type and whether you are inside a *khu đông dân cư*. Everything
except that last input is either in the map or set by the user. The *đông dân cư* boundary
is the hard part: the law defines it by a physical roadside sign, and OSM records **17** of
those for the whole country. So the product is, underneath, a boundary detector, with the
speed limit falling out of a lookup once the boundary is known. That same fact is the
competitive edge: because limits are computed rather than looked up, the app knows the
**next** limit before you reach it, which a sign database cannot.

---

## What we learned

### 1. The map data (OpenStreetMap)

Source: Geofabrik `vietnam-latest.osm.pbf`, replication timestamp 2026-09-19T20:22:34Z,
analysed with osmium-tool 1.19.1. Road kilometres are way-centreline km, so divided roads
count once per direction.

**Speed limits are sparse except on expressways.**

| Class | km | `maxspeed` coverage | `lanes` coverage | Named |
|---|---:|---:|---:|---:|
| cao tốc | 7,701 | **89.0%** | 91.5% | 94.9% |
| quốc lộ | 40,892 | 20.4% | 45.9% | 97.7% |
| tỉnh lộ | 32,470 | 7.6% | 17.2% | 87.7% |
| urban street | 132,524 | 1.2% | 3.3% | 13.8% |
| residential | 376,207 | 0.4% | 0.6% | 6.1% |
| **all** | **661,061** | **3.2%** | | |

The `maxspeed` tags that do exist are recent (median last edit 2026), so where OSM has a
limit it is worth trusting. Full detail in [`spike-results.md`](docs/spike-results.md).

**The two things that matter most are nearly absent.**

| | Nationwide |
|---|---:|
| *Đông dân cư* boundary signs (`city_limit`, `VN:R.420`) | **17** |
| Speed cameras (`highway=speed_camera`) | **43** |

**Road shape and junctions are well mapped.** This is what makes a forward "mini-map" view
possible.

| | Count |
|---|---:|
| Junctions (nodes shared by 3+ drivable ways) | **248,779** |
| Turn restriction relations | 3,531 |
| Roundabouts (`junction=roundabout`) | 3,808 |
| Traffic signals | 7,883 |
| Median vertex spacing, quốc lộ / tỉnh lộ | 21 m |
| Median vertex spacing, cao tốc | 57 m (p90 297 m) |

21 m spacing is fine enough to draw a road's real curve. Cao tốc is sampled most coarsely,
which is where it matters least (long gentle curves) except at interchange ramps.

**Lane-level guidance is not available.**

| | Ways nationwide |
|---|---:|
| `turn:lanes` (which lane turns where) | 1,355 |
| `destination` signposts | 1,560 |
| `lanes:forward` / `lanes:backward` | 412 |

So lane *counts* can be drawn where tagged, split at the centre line, but "get in the left
lane" cannot be said. Out of 2.77 million drivable ways, per-direction lane data is
effectively zero.

**Other sign-worthy features are recoverable from their own tags**, not from `traffic_sign`:
level crossings (6,264), toll booths (840), speed bumps and humps (773), rumble strips
(4,719), tunnels (4,206). Stop and give-way signs are essentially unmapped (30). Gradients
are not in OSM at all and would need an elevation dataset.

**Offline fits on a phone.** Packed as quantised delta-encoded geometry plus class, speed
and confidence bytes: trunk network (cao tốc + quốc lộ + tỉnh lộ) **4.4 MB**, full alerting
network 53.8 MB, all drivable roads 66.6 MB, gzipped. No tile server needed to launch.

### 2. The law: Thông tư 38/2024/TT-BGTVT

Read from the official PDF on the government portal, not from news summaries. Effective
2025-01-01.

**Điều 3.1 defines *đông dân cư* by the sign itself**: the stretch between the signs
"Bắt đầu khu đông dân cư" and "Hết khu đông dân cư". Not land use, not administrative
boundaries. An inferred boundary is therefore a guess at *where the sign is*, and can be
legally wrong in places that look obviously urban.

**Điều 4.2**: where no speed sign is posted, Điều 6, 7, 8 and 11 apply. Sign overrides
statute; statute is the floor. That is the architecture.

**Bảng 1 — inside *đông dân cư*** (all motor vehicles except Điều 7 and 8):

| | Divided, or one-way with 2+ lanes | Two-way undivided, or one-way with 1 lane |
|---|---:|---:|
| All | 60 | 50 |

**Bảng 2 — outside *đông dân cư***:

| Vehicle | Divided / one-way 2+ lanes | Two-way / one-way 1 lane |
|---|---:|---:|
| Car ≤28 seats; truck ≤3.5 t | 90 | 80 |
| Coach >28 seats; truck >3.5 t (not tanker) | 80 | 70 |
| Bus; tractor-semitrailer; **xe mô tô**; special-purpose car | 70 | 60 |
| Towing a trailer; concrete mixer; tanker | 60 | 50 |

**Điều 7**: xe máy chuyên dùng and **xe gắn máy** (≤50 cc): **40** everywhere except cao tốc.
Note *xe mô tô* (>50 cc) is in Bảng 2, not here — two different vehicles, 30 km/h apart, and
the summaries routinely merge them.

**Điều 8**: four-wheeled motorised passenger carts 30, cargo carts 50.

**Điều 9 — cao tốc**: maximum 120, minimum 60, and the actual limit is set per route in its
approved traffic plan and must be signposted. **The statute cannot compute a cao tốc limit,
only bound it.** This lands neatly against the data: cao tốc is exactly where OSM has 89%
coverage. The law covers the gaps in the map, and the map covers the gap in the law.

**Two corrections to earlier assumptions:**

- The limit does depend on lanes, but the real split is **divided vs undivided**. A two-way
  undivided road takes the lower column no matter how many lanes it has; lane count only
  matters for one-way roads.
- Lane *position* (which lane you are in) is irrelevant to the limit and undetectable with
  phone GPS anyway (3–5 m accuracy against 3.5 m lanes).

**What can go wrong, ranked:**

| Risk | Error | Direction | Data |
|---|---|---|---|
| *Đông dân cư* wrong | 20–30 km/h | either way | 17 nodes |
| Divided/lanes unknown | 10 km/h | conservative if defaulted low | 46% on quốc lộ |
| Cao tốc limit unknown | bounded 60–120 | needs a sign | 89% in OSM |

Only the first can fail *upward* — announcing 90 where the limit is 60.

### 3. The competition

| | WYN (App Store) | Vietmap Live Pro | OSM, our starting point |
|---|---:|---:|---:|
| Speed cameras | 7,000+ | 10,000+ | 43 |
| *Đông dân cư* zones | 8,500+ | — | 17 |
| Speed limit signs | 14,000+ | — | sparse |
| Price | free + IAP | ~169,000đ / 30 days | — |

Their advantage is not software, it is a hand-surveyed database of exactly the three things
open data lacks. The 8,500 surveyed zones are arguably a bigger asset than the cameras.

Openings:

- **Coverage.** A sign database can only speak where it has a sign. A statutory function
  gives a lawful limit on every road.
- **Staleness, unverified.** WYN's US App Store listing shows its latest update as
  2024-09-05 and says its data is built into the app. If so, its limits predate Thông tư
  38/2024 taking effect. Worth confirming on the Vietnamese storefront before relying on it.
- **Price pain.** A grey market rents shared Vietmap accounts from ~8,000đ/day, which
  suggests the official price hurts.

Honest positioning: this app serves drivers who want to **comply**. Camera apps serve
drivers who want to **not get caught**. The second group is large and already paying, and
this app will not win them on day one.

### 4. Things we checked and ruled out

**Mapillary** (street-level imagery with automatic sign detection). Its taxonomy includes
`information--built-up-area` and `information--end-of-built-up-area`, which is precisely the
missing boundary sign, so it was worth checking properly. Parked, because:

- Of 8 major cities queried, only Hà Nội, TP.HCM and Đà Nẵng answered at all. Across those,
  **zero** built-up-area detections. The rest timed out server-side.
- The Graph API rejects anything over 0.01 square degrees, silently returns nothing when
  `limit` exceeds 100, silently ignores unknown `object_values`, and times out (HTTP 500 at
  ~31 s) wherever coverage is thin. A national census through it is not practical.
- Licensing: the Traffic Sign Dataset is CC BY-NC-SA (no commercial use). Map features are
  CC BY-SA (share-alike), and commercial use of the service carries separate terms.

Still useful later without redistribution: validating our boundary inference against their
imagery, and doing the ground-check routes from a desk.

**An LLM at runtime.** Not needed, and would hurt. The core output is a deterministic lookup;
a generative model could invent a number, needs a network (breaking offline), and cannot
answer at 1 Hz within the latency a driver needs. LLMs are useful in tooling — reading
legislation, cleaning crowdsourced reports — never in the announcement path.

### 5. Platform constraints

**iOS has no way to draw over another app.** Android's "draw over other apps" permission has
no iPhone equivalent. So the floating bubble over Google Maps is **Android-only**.

| | Alongside another app |
|---|---|
| Android | True floating bubble. User must grant the overlay permission manually in Settings |
| iOS | No overlay. Dynamic Island and Lock Screen via Live Activities, which since iOS 26 also appear in CarPlay |
| Both | Audio while backgrounded |

Vietnam is predominantly Android and the incumbents are Android apps, which argues for
Android first. If the app is the foreground screen (see below), the iOS limitation mostly
stops mattering.

---

## Product direction

The current intent is for the app to be the **foreground screen**, showing a minimal
forward view of the road ahead so that on familiar routes the driver does not need a map app
open at all. That covers most driving (commutes, regular trips).

What that view can honestly show: the road's real shape, the junction ahead with each
branch's name and **speed limit**, lane counts where known, and upcoming limit changes.

What it cannot: turn-by-turn directions to a new address. Routing itself is buildable
(Valhalla and OSRM run on the same OSM extract, and Valhalla works offline), but live
traffic, lane guidance and good place search are not available, so for an unfamiliar
destination the driver would still reach for Google Maps. **Turn-by-turn is a separate
decision, not yet made.**

The Android bubble and the foreground mini-map are alternative products, not two features.
One should be primary.

---

## Design direction

Explored in the [prototype](https://claude.ai/artifact/H5trR8fNJBfzKPX4e5CpoS). Boards:
*Ban ngày* (interactive trip), *Ranh giới đông dân cư* (drag across a boundary), *Ngã tư
phía trước* (approach a junction), *Ban đêm*, *Chế độ nổi*, *Chạy nền trên từng nền tảng*,
*Bốn mức tin cậy*, *Kiểm chứng*.

Decisions so far:

- **iOS-native look**, light by day and dark at night automatically. Typeface: Be Vietnam
  Pro, drawn for Vietnamese diacritics.
- **Current speed is the largest thing on screen.** The limit sign is a smaller badge.
- **The speed sign is always the real white-and-red sign**, never recoloured, because its
  shape is what makes it readable in a glance.
- **Confidence is a coloured ring outside the sign**, plus a text label for colour-blind
  drivers: green confirmed, amber from statute, blue driver-reported, grey unknown. Tested
  against a dashed-ring alternative with peripheral blur; the dashed version became
  indistinguishable, colour did not.
- **Red means one thing only: you are over the limit.** Confidence never uses red.
- **When the limit is unknown, show no number and say nothing.** On cao tốc without sign
  data the law only gives 60–120.
- **Forward perspective road**, flat ground plane, distance compressed so far features stay
  legible (true perspective shrinks a 500 m junction to a few pixels).
- **What is coming goes on the right shoulder**, where Vietnamese signs actually stand. The
  current limit appears once, in one fixed place.
- **Real R.420 / R.421 plates** for *đông dân cư* boundaries.
- **Draw only what the data supports.** No lane dividers where `lanes` is untagged; labels
  omitted when too small to read.

Known issues in the prototype: road shapes are generated, not yet from real OSM geometry;
the boundary line is drawn at full confidence even though it will usually be inferred;
*Ban đêm* predates the latest layout.

---

## Open decisions

1. Foreground mini-map vs Android bubble as the primary product.
2. Whether to build turn-by-turn, and if so for which trips.
3. Android first, or both platforms at once.
4. How the voice should sound different for a statutory limit versus a confirmed one.
5. How many independent driver traces promote a report to confirmed.

## Next steps

1. **Statutory speed function.** Pure, import-free module with a `node --test` suite,
   encoding Bảng 1, Bảng 2 and Điều 7–9 above, including the edge cases the summaries get
   wrong.
2. ***Đông dân cư* inference module**, with its own confidence, built from
   `landuse=residential`, `place` nodes, commune boundaries and road class.
3. **Ground check on three real routes** — one urban, one quốc lộ, one cao tốc. Needs the
   routes named.
4. Wire the prototype's road renderer to real OSM geometry.
5. Give the boundary line its own confidence encoding in the design.

---

## Reproducing the numbers

Everything above was measured from the 2026-09-19 Geofabrik extract with osmium-tool and
short Python scripts streaming osmium's GeoJSON export. The scripts are not in the repo yet.
The extract and anything derived from it are git-ignored — a 313 MB pbf in history is not
recoverable without a rewrite.
