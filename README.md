# Road Alerts

*Working title.*

A Vietnamese driving companion that tells you the legal speed limit on any road, by voice
and on a glanceable screen, and gets more accurate every trip as drivers correct it.

**Status: early.** The data feasibility spike has run, the speed law has been read at
source, and the core speed function exists with a coordinate tester for TP.HCM. The web
app is the product for now, used by the household from the iPhone home screen: it opens on
a map of where the car is, turns into a forward road view with the limit, lights ahead and
voice when the car drives off, and keeps the whole TP.HCM map on the phone (~16 MB, fetched
in the background) so it works without signal. The next piece
of work is making a driver's answers to Sai correct their own phone (see
[Next steps](#next-steps)).

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

The test app, on this Mac or a phone on the same Wi-Fi:

```sh
npm run site     # the page, plus map tiles when the map data is newer than them
npm run serve    # prints the localhost and LAN addresses
```

Under ⋯ on the home screen, the "Xem thử, không cần lái" drives run a pretend car along
real roads, one fix a second like a phone's GPS, through the same matching, law and drawing
as a real drive; `?demo=q1` starts one straight away. Most wander wherever the road goes;
`?demo=tamanh` drives a route instead, 7 km from Tân Thạnh street to Bệnh viện Tâm Anh on
Phổ Quang, worked out over the tiles by `tools/demo-route.js`. A demo runs on its own clock:
`?x=4` plays it at 4x (2 and 8 too; the voice keeps quiet above 2x, since a recorded line
cannot be hurried), and `?km=4.1` starts it 4.1 km in, just short of the Hoàng Hoa Thám
flyover on the Tâm Anh route. The same can be done on the demo's bar: its button steps the
speed, and dragging along it jumps, snapping to just before each flyover marked on it.
Real GPS needs https, so a real drive
uses the GitHub Pages link, which every push to `main` redeploys. In Safari, Share → Add to
Home Screen turns it into an app with its own icon.

---

## Where things are

| | |
|---|---|
| [`docs/spike-brief.md`](docs/spike-brief.md) | What the data spike set out to answer |
| [`docs/spike-results.md`](docs/spike-results.md) | The five spike numbers and what they imply |
| This README | Everything learned since: the law, competitors, platforms, design |
| [`src/`](src) | The speed law, the đông dân cư guess, map lookup, the road ahead, lights, smooth motion, the view's camera and how fingers are read, with tests |
| [`web/`](web) | The test app: page, road view renderer, offline worker, icon |
| [`tools/`](tools) | Data preparation, the coordinate tester, the route simulator and the local server |
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
| *Đông dân cư* entry/exit signs | 8,500+ (~4,000 boundaries) | — | 17 |
| Speed limit signs | 14,000+ | — | sparse |
| Price | free + IAP | ~169,000đ / 30 days | — |

Their advantage is not software, it is a hand-surveyed database of exactly the three things
open data lacks. The ~4,000 surveyed boundaries are arguably a bigger asset than the
cameras.

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

**Traffic lights are a requirement, not an extra.** Most *phạt nguội* is red-light and
stop-line enforcement at city junctions, not speed, and OSM has no usable camera data to
warn about it (43 speed cameras, about 18 traffic-facing surveillance nodes, none marked
as issuing fines). But warning about the light is correct whether a camera is there or
not, and the lights themselves are well mapped: 7,883 `highway=traffic_signals` nodes
nationally, 3,423 in the HCM box. About 4,500 carry `traffic_signals:direction`, which
lets us skip lights facing the opposite carriageway, and 2,412 are signalised pedestrian
crossings. A missing light means silence and a slightly misplaced one costs nothing, so
this stays inside the rule of never announcing what is not real. Cameras stay a separate,
crowdsourced layer for later.

What it cannot: turn-by-turn directions to a new address. Routing itself is buildable
(Valhalla and OSRM run on the same OSM extract, and Valhalla works offline), but live
traffic, lane guidance and good place search are not available, so for an unfamiliar
destination the driver would still reach for Google Maps. **Turn-by-turn is a separate
decision, not yet made.**

The Android bubble and the foreground mini-map are alternative products, not two features.
One should be primary.

---

## Design direction

Explored in a set of design mockups during planning, since retired. The decisions carry
into the test app, where the screen is built from real map data.

Decisions so far:

- **iOS-native look**, light by day and dark at night automatically. Typeface: Be Vietnam
  Pro, drawn for Vietnamese diacritics.
- **Current speed is the largest thing on screen.** The limit sign is a smaller badge.
- **The speed sign is always the real white-and-red sign**, never recoloured, because its
  shape is what makes it readable in a glance.
- **Confidence is a small text label under the sign** ("Theo luật", "Đã xác nhận",
  "Người dùng báo"), and a difference in the voice. Two ring designs were tried and
  dropped: a dashed ring was unreadable at a glance, and a coloured outer ring looked
  like a target.
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
- **Traffic lights ahead** appear on the right shoulder with the other upcoming features,
  with a monochrome lamp icon (red is reserved for speeding), and are spoken once per
  junction ("Đèn giao thông phía trước", or "Đèn qua đường" at a signalised crossing)
  about 8 seconds out at current speed, 80–300 m. Only lights on the road being driven and
  facing the driver's direction count, and the look-ahead stops at any junction where
  that road does not obviously continue: a light announced on a road the driver is not
  taking teaches them to ignore the voice.
- **One natural voice, from a fixed phrase bank.** Every phrase is written and approved by
  hand, then recorded once (voice actor or a good Vietnamese neural TTS) and shipped as
  audio, numbers 5–120 included. Nothing is generated while driving: alerts must be instant
  and offline, and a generated sentence can soften or change a number. Warmth comes from
  wording, not from length: one consistent form of address, a few rotating variants per
  alert, a greeting at trip start, and silence when there is nothing to say.
- **Confidence is heard in the wording.** A statutory limit is spoken as the law ("Theo
  luật, 60"), a confirmed one as a plain number. LLMs help only off the road: drafting
  phrase variants for review, and the parked post-drive trip summary.

There is one screen, parked or driving, and no start screen:

- **Opening the app is parking.** The map of where the car is, seen from above like a map
  app, with the street's name, the limit there for the vehicle driven last in small, and
  any Sai still waiting for review.
- **One tap on the vehicle starts the drive.** iOS will not let a page make a sound until
  it is tapped, so the tap it needs anyway answers the one question the law needs from
  the driver. Two buttons for now, Ô tô (≤ 28 chỗ) and Xe máy (trên 50 cc), for the
  vehicles the household drives; the one driven last is filled. The camera swings down into
  the driver's seat and the small sign grows into the badge.
- **The voice waits for the car to move.** The tap gets one soft tone, lower than every
  other cue; "Bắt đầu" and the limit come when the car sets off (past 2 m/s, or 60 m at a
  crawl). Parked, the road was matched with no direction to go on, so the screen may show
  that guess but the voice does not say it.
- **Driving off without a tap still drives.** Past 10 km/h the screen turns to driving on
  the vehicle used last, and asks "Chạm để bật giọng nói" for the voice.
- **The trip ending is coming home.** Five minutes standing still, ten minutes away from
  the app, or Dừng: the camera rises again and the trip's Sai arrive in the panel. The
  screen is then allowed to sleep until the next touch.
- **Out of the daily path:** demo drives, export and clearing the log live under ⋯, and
  "Thêm vào Màn hình chính" shows only in Safari.

The road view is built into the test app from the phone's own map tiles:

- **The road ahead is picked out** only as far as it obviously goes, fading where it
  reaches a junction the app cannot see through. Lights and shoulder signs read the same
  walk ahead, so the three never disagree about which road comes next.
- **Between GPS fixes the car keeps moving** along its matched road, and a fix that
  disagrees is eased in from the car's current velocity, so nothing lurches once a second.
  It never runs more than 1.5 s past the last fix or round a junction on a guess, and it
  stands still at a light through GPS wobble.
- **Turns follow the car, not the map.** Once the phone's heading swings off the road, the
  car on screen slows into the junction instead of carrying straight past it, the view
  turns with the phone's course, and the new road is joined on a curve.
- **Lane lines are paint**, on every road in view whose lanes OSM counts: laid out in
  metres from each road's own start, so they stream past under the car, and the street a
  turn leads into shows its lanes before the car is on it. Which lane goes where is never
  drawn, because OSM almost never says (see above).
- **A shoulder sign is a promise**: it is decided by the same stabiliser as the badge, so
  a stretch the badge would ignore never gets a sign. When the badge changes, the sign just
  passed flies into it. Signs that line up stack on one pole, like plates on a real post.
- **Redrawn at 30 frames a second at most, and not at all when standing still**, because
  the phone is on for the whole drive in a hot car.
- **Looking around only while stopped.** Parked or at a light, the map moves the way Apple
  and Google Maps do: one finger drags and a flick glides; two pinch and turn about the
  fingers (turning only past 12°, so a pinch does not knock the map askew) or, side by
  side, slide up and down to tilt; a double tap zooms in, a two-finger tap zooms out, and a
  double tap held and dragged zooms with one finger. **Zooming out lifts the camera and
  tips it toward straight down**, so the streets around the car spread out instead of
  piling up at the horizon; zooming back in returns to the driver's angle. A "Về vị trí"
  pill springs it all back. Once the car moves the view springs back by itself and fingers
  do nothing but show "Dừng xe để xem bản đồ": a map left turned while driving no longer
  matches the windscreen.
- **Until the phone first moves it has no direction**, so the map is north-up around a
  location dot, with nothing picked out ahead.
- **One-way streets carry grey arrows** painted on the road, as in the map apps: laid out
  once from the map, so they stay put as the car drives over them, and fading out where
  the road gets too thin on screen to hold one. They point the way *the chosen vehicle*
  may go: ~190 streets in central TP.HCM (Phạm Ngũ Lão, Lê Lai, Cách Mạng Tháng Tám…) are one-way for
  cars but two-way for xe máy (`oneway:motorcycle=no`), and road matching and the walk
  ahead follow the same rule, so a rider going legally against the cars is neither
  matched to a side street nor cut off from the road ahead.

Still to do: the junction view (branch names and their limits) and real R.420 / R.421
plates at đông dân cư boundaries.

---

## Open decisions

1. Foreground mini-map vs Android bubble as the primary product.
2. Whether to build turn-by-turn, and if so for which trips.
3. Android first, or both platforms at once.
4. Which voice records the phrase bank, and which form of address it uses. (How statutory
   and confirmed limits differ is settled: by wording, see Design direction.)
5. How many independent driver traces promote a report to confirmed.
6. Whether the badge should change at a mapped sign for a higher limit. Today it waits
   250 m, to ride out map pieces that flicker, so a driver passes a "60" and still sees 50
   for a while. A sign drawn on the shoulder is already one the stabiliser will adopt.

## Next steps

1. ~~Statutory speed function and đông dân cư guess~~ — done, with a coordinate tester.
2. ~~iPhone test app~~ — done: GPS, Vietnamese voice, the road view, one-tap error logging
   for a passenger, demo drives, home-screen install and offline tiles.
3. ~~Traffic-light warning~~ — done: in the test app, the simulator, and the trip log.
4. ~~Home screen~~ — done: the app opens parked on the map, and a tap on the vehicle or
   driving off starts the drive.
5. **Answers correct your own phone:** a limit given on a Sai card replaces the app's
   number on that stretch the next time this phone passes it, labelled as the driver's
   own report. Most driving is the same few routes, so a commute gets right within a week,
   with no server.
6. **Test drive:** TP.HCM city streets, plus QL1 near Tân An, QL22 near Trảng Bàng and
   QL13 near Bến Cát. After the 2025 ward mergers those stretches sit inside large
   *phường*, so they are where the đông dân cư guess is weakest. The city streets also
   check the traffic-light warnings.
7. **Decide** from the results: launch main roads on the guess, or pay for a survey of
   main-road boundaries first.
8. **Fix:** where OSM maps one road as alternating pieces with different limits (a stretch
   of Nguyễn Văn Linh alternates 60 and 80), each switch restarts the stabiliser's
   distance, so the badge can stay on a lower limit for 400 m after the road has gone back
   up. Safe-side, but wrong.
9. Junction view from real geometry.

---

## Reproducing the numbers

Everything above was measured from the 2026-09-19 Geofabrik extract with osmium-tool and
short Python scripts streaming osmium's GeoJSON export. The scripts are not in the repo yet.
The extract and anything derived from it are git-ignored — a 313 MB pbf in history is not
recoverable without a rewrite.
