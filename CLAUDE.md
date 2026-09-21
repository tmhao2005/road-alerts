# CLAUDE.md

Working title only. Rename the repo before anything depends on it.

A Vietnamese driving companion: speed limits, traffic signs and enforcement cameras
announced by voice while driving, with the data getting better every trip instead of going
stale.

## Status

Pre-code. The data feasibility spike has run — `docs/spike-results.md`. It reported that
OSM speed limit coverage is 3.2% nationally, đông dân cư boundaries are absent (17 nodes
countrywide) and speed cameras are absent (43 nodes). So: the statutory function is the
product, inferring the đông dân cư boundary is a core component rather than a fallback, and
the camera layer is a cold-start crowdsourcing problem with nothing to seed it. The trunk
road network packs to 4.4 MB, so offline-first is settled and no tile server is needed.

Next, and still before an app: the statutory speed function (priority 3), then the
three-route ground check the spike scopes out — which needs Hao to name the routes.

## Why this exists

The incumbents are paid Android apps shipping a static database that decays. Google Maps'
speed limit and camera alerting is not enabled in Vietnam, so the position is open rather
than occupied by a free Google feature. The wedge is freshness: corrections from drivers,
corroborated by repeat traces through the same point.

## Priorities

Carried over from the lottery Mini App deliberately, in this order.

**1. Components are smart, animated, fun and iOS-like.** With one caveat this product
forces: most of the interaction is audio, aimed at someone whose eyes are on the road. The
animation budget belongs where it is actually seen. That means the moment a limit changes
(the number arrives, it is not rewritten between two frames), a HUD legible in 200ms of
peripheral vision, and the post-drive trip replay, where the car is parked and you can be as
playful as you like.

**2. Never announce a number that is not real.** The lottery app's hardest rule, and it gets
harder here, because a wrong limit spoken confidently costs someone a fine. Every speed value
carries a confidence tier from the first commit:

```
CONFIRMED   signposted, seen and corroborated
DEFAULT     derived from statute, no sign data
REPORTED    crowdsourced, not yet corroborated
```

The voice must sound different for DEFAULT than for CONFIRMED. Never round a DEFAULT to
sound more authoritative than it is.

**3. Statute first, map data second.** Vietnam's limits are set by law, not by signs:
Thông tư 38/2024/TT-BGTVT, effective 2025-01-01, replacing 31/2019. Given road class,
vehicle type and inside/outside đông dân cư, the limit is determined. A sign only matters
where it overrides the default. So the baseline is a pure function over static rules and map
data is a correction layer on top, not the other way round. Read the circular itself rather
than a news summary: the edge cases (xe gắn máy under 50cc, xe máy chuyên dùng, cao tốc
minimums) are exactly where the summaries are wrong.

**4. Keep the OSM layer and our layer in separate databases.** OpenStreetMap is ODbL, which
is share-alike on derived databases. Merging our crowdsourced corrections into an OSM extract
arguably makes the whole thing a derived database we owe back. Two separate tables joined at
query time is a collective database, which ODbL permits. This is structural, not paperwork:
decide it before the first schema, because unpicking it later means a migration.

**5. This cannot be a Zalo Mini App.** Background geolocation with the screen off, plus audio
over whatever app is in the foreground, is native territory. Checked before the repo existed.

## Conventions

Inherited from the lottery app and still right here:

- Comments carry the why, not the mechanics. A comment restating the line is worse than none.
- Pure logic lives in its own import-free module with a `node --test` test. The statutory
  speed function is the first of these and the most important one in the project.
- Vietnamese UI text, English code and comments. Times are Vietnam local, computed as plain
  UTC+7 arithmetic.
