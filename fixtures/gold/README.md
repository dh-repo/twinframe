# Civilian gold photos

Drop labeled non-celebrity frontals here, then encode:

```bash
node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/civilian-01.jpg \
  --id civilian-01 \
  --accept ana-de-armas,margot-robbie

node --experimental-strip-types scripts/encode-gold-probe.mjs \
  --image fixtures/gold/no-match-01.jpg \
  --id civilian-refuse-01 \
  --refuse
```

Do not invent faces or look-alike labels. A useful first set is ~12 frontals (mix of gender/age) plus ~4 human “no doppelgänger” refuses.
