# Civilian gold photos

Royalty-free Unsplash frontals used as **open-set probes**. See [ATTRIBUTION.md](./ATTRIBUTION.md).

These people are not in the celebrity gallery. Do not invent look-alike names.

```bash
node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/civilian-01.jpg \
  --id civilian-01 \
  --refuse

node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/civilian-01.jpg \
  --id civilian-01 \
  --accept ana-de-armas,margot-robbie
```

`--accept` needs a human-ranked celebrity list. The shipped first set is refuse-only (single-rater visual). A useful next pass is 3+ people naming acceptable celebs, or confirming refuse.
