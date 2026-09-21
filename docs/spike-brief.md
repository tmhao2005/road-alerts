# Data feasibility spike

Run 2026-09-21. Results in `spike-results.md`; this brief is kept as written for the record.

## The question

Is this a software problem or a data collection problem? If the map data is thin enough,
the statutory function is the product and OSM is a footnote. If it is rich, the shape of
the app is completely different. We cannot tell by guessing, and every architectural choice
downstream depends on the answer.

## Method

1. Download `vietnam-latest.osm.pbf` from Geofabrik. 313 MB, refreshed daily, data through
   2026-09-19 at time of writing.
2. `brew install osmium-tool`. Nothing OSM-related is installed on this machine.
3. Filter to highways, export geometry, compute road kilometres by class.
4. Measure the five numbers below.

## The five numbers

1. **Explicit `maxspeed` coverage, by road class.** Fraction of road kilometres carrying the
   tag, split cao tốc / quốc lộ / tỉnh lộ / urban street / residential. This is the headline
   number. It decides whether OSM is the primary source or a correction layer.

2. **Đông dân cư boundary coverage.** Count of R.420/R.421 equivalents
   (`traffic_sign=city_limit` and Vietnamese variants). This is the one input the statutory
   function cannot derive for itself. If it is near zero, the function has no way to know
   which side of the boundary you are on, and a fallback (inferring from `landuse=residential`
   or `place` nodes) becomes load bearing. Finding out whether we need that fallback is half
   the value of this spike.

3. **Speed camera nodes.** Whether `highway=speed_camera` appears in Vietnam at all. This is
   plausibly the feature people actually pay for, so if OSM is empty here then that half of
   the product is purely a crowdsourcing problem from day one.

4. **Offline bundle size.** Roads plus only the tags we need, filtered and packed. Decides
   whether offline-first fits on a phone or whether a tile server is required immediately.
   Offline matters more than usual here: the cao tốc stretches where speed enforcement is
   heaviest are also where coverage drops.

5. **Freshness.** Last-edit dates on the tagged ways. A `maxspeed` set in 2016 is not
   evidence about a road in 2026, and a coverage number that ignores age flatters itself.

## Definition of done

A table of those five numbers plus one paragraph on what they imply for the architecture.
No app code, no scaffolding.

## What it deliberately does not answer

Whether any of it is correct on the actual road. That needs three real routes checked by
hand, one urban, one quốc lộ, one cao tốc, and it needs the statutory function written
first. Separate piece of work, a couple of hours, and Hao needs to name the routes.
