# Twinframe held-out accuracy (stratified)

**Generated** 2026-08-18T05:39:45.386Z  
**Engine** EdgeFace-512 + SCRFD-2.5G (shipping AFv4 gallery + 724 extra templates)  
**Gallery** 1980 vectors / 999 identities (980 of them extra templates and centroids, as the browser builds it)  
**Probes** 205 held-out photos (slot 001 only)  

Held-out means the photo was never enrolled: a different Wikipedia/Commons image of the same person. Age and gender priors are passed as unknown, because feeding the query the true celebrity's own age and gender leaks the label. Refusals — the product declining to show any match — count as misses.

## Headline

| Cohort | Probes | Rank-1 | 95% CI | Rank-5 | Refused |
| :--- | ---: | ---: | :---: | ---: | ---: |
| **Held out for real** (near-duplicates removed) | 144 | **75%** | 67.3–81.4% | 77.8% | 0% |
| Every probe on disk (leakage included) | 205 | 82.4% | 76.6–87% | 84.4% | 0% |

61 of 205 probes (29.8%) sit within cosine distance 0.05 of their own gallery vector: the same source photo at another resolution, which the fetcher's byte-level dedupe cannot detect. Every one of them scores Rank-1 for free, so the first row is the number to quote.

Raw nearest-neighbour Rank-1 (no gates, no priors): 82.4% over all probes, 75% with near-duplicates removed.

## Per hard-probe condition

Near-duplicates removed (the honest view):

| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |
| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |
| Low light | 12 | 33.3% | 13.8–60.9% | 41.7% | 33.3% | 0% | auto (SCRFD geometry) |
| Glasses | 0 | — | — | — | — | — | manual labels only |
| Big smile | 77 | 85.7% | 76.2–91.8% | 88.3% | 85.7% | 0% | auto (low-confidence proxy) |
| Yaw > 25° | 32 | 68.8% | 51.4–82% | 71.9% | 68.8% | 0% | auto (SCRFD geometry) |
| Phone close-up | 0 | — | — | — | — | — | auto (SCRFD geometry) |
| No condition fired | 46 | 67.4% | 53–79.1% | 69.6% | 67.4% | 0% | derived |

All probes on disk, leakage included:

| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |
| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |
| Low light | 18 | 55.6% | 33.7–75.4% | 61.1% | 55.6% | 0% | auto (SCRFD geometry) |
| Glasses | 0 | — | — | — | — | — | manual labels only |
| Big smile | 122 | 91% | 84.6–94.9% | 92.6% | 91% | 0% | auto (low-confidence proxy) |
| Yaw > 25° | 39 | 74.4% | 58.9–85.4% | 76.9% | 74.4% | 0% | auto (SCRFD geometry) |
| Phone close-up | 0 | — | — | — | — | — | auto (SCRFD geometry) |
| No condition fired | 57 | 73.7% | 61–83.4% | 75.4% | 73.7% | 0% | derived |

Cohorts overlap — a probe can be dark and turned away at once — and every cohort is a subset of the same held-out set, so the strata are not independent samples.

Empty cohorts, and why:

- **Glasses** — no labelled image carries it. Provenance: manual labels only.
- **Phone close-up** — 8 labelled images do carry it, but none are held-out probes (they are enrolled slots 002+), so this protocol has nothing to score.

## Distance distributions

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 205 | 0.3314 | 0.0034 | 0.3209 | 0.8251 |
| impostor (probe → best other identity) | 205 | 0.5852 | 0.5095 | 0.6031 | 0.6617 |

Near-duplicates removed:

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 144 | 0.4694 | 0.2278 | 0.4165 | 0.8858 |
| impostor (probe → best other identity) | 144 | 0.581 | 0.5077 | 0.601 | 0.6617 |

## Hill calibration (HILL_D0 / HILL_N)

Fitted by minimising the log-loss of "is the top match the right person?" over genuine vs best-impostor distances (a 1:1 sample, matching the question the UI asks).

**Near-duplicates removed (use this one)**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.729
- best fit: `HILL_D0 = 0.5`, `HILL_N = 2.5` — log-loss 0.6722
- equal-error distance 0.5678 at 26.39% error
- expected calibration error: current **8.4 pts**, best fit 18.29 pts (probe-weighted mean gap between claimed and observed)

Reliability of the displayed percentage — what the curve claims versus how often the top match was actually the right person:

| Claimed band | n | mean claimed | observed correct | overstatement (current) | overstatement (fitted) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 20-40% | 3 | 37.2% | 0% | +37.2 pts | +24.4 pts over 18 |
| 40-60% | 27 | 50.3% | 25.9% | +24.4 pts | -17.2 pts over 43 |
| 60-80% | 30 | 71.8% | 76.7% | -4.9 pts | -21.8 pts over 52 |
| 80-95% | 50 | 88.8% | 92% | -3.2 pts | -8.8 pts over 26 |
| 95-100% | 34 | 98% | 94.1% | +3.9 pts | +18.6 pts over 5 |

The two overstatement columns are not the same probes: refitting moves each probe into a different claimed band, so compare the size of the errors, not the rows.

Log-loss and calibration disagree here, and calibration is the one the user experiences. The best-fit curve wins on log-loss by flattening every percentage toward the middle, which trades a small gain in the confident bands for a much larger understatement in the middle ones.

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.6951 |
| 0.55 | 1.4 | 0.6893 |
| 0.55 | 1.6 | 0.6847 |
| 0.55 | 2 | 0.6789 |
| 0.55 | 3 | 0.6801 |
| 0.55 | 4.1 | 0.6999 |
| 0.6 | 1.2 | 0.6994 |
| 0.6 | 1.4 | 0.695 |
| 0.6 | 1.6 | 0.6919 |
| 0.6 | 2 | 0.6894 |
| 0.6 | 3 | 0.6995 |
| 0.6 | 4.1 | 0.729 |
| 0.65 | 1.2 | 0.7056 |
| 0.65 | 1.4 | 0.7032 |
| 0.65 | 1.6 | 0.7023 |
| 0.65 | 2 | 0.7048 |
| 0.65 | 3 | 0.729 |
| 0.65 | 4.1 | 0.7758 |

- verdict: **keep-current (refit lowers log-loss only by hedging)**

**All probes, leakage included**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.6263
- best fit: `HILL_D0 = 0.45`, `HILL_N = 2.9` — log-loss 0.5408
- equal-error distance 0.5536 at 19.51% error
- expected calibration error: current **5.9 pts**, best fit 11.71 pts (probe-weighted mean gap between claimed and observed)

Reliability of the displayed percentage — what the curve claims versus how often the top match was actually the right person:

| Claimed band | n | mean claimed | observed correct | overstatement (current) | overstatement (fitted) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 20-40% | 3 | 37.2% | 0% | +37.2 pts | -2 pts over 36 |
| 40-60% | 27 | 50.3% | 25.9% | +24.4 pts | -32.8 pts over 36 |
| 60-80% | 30 | 71.8% | 76.7% | -4.9 pts | -20.4 pts over 41 |
| 80-95% | 50 | 88.8% | 92% | -3.2 pts | -9 pts over 25 |
| 95-100% | 95 | 99.3% | 97.9% | +1.4 pts | +1.3 pts over 67 |

The two overstatement columns are not the same probes: refitting moves each probe into a different claimed band, so compare the size of the errors, not the rows.

Log-loss and calibration disagree here, and calibration is the one the user experiences. The best-fit curve wins on log-loss by flattening every percentage toward the middle, which trades a small gain in the confident bands for a much larger understatement in the middle ones.

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.5866 |
| 0.55 | 1.4 | 0.5814 |
| 0.55 | 1.6 | 0.5773 |
| 0.55 | 2 | 0.5718 |
| 0.55 | 3 | 0.5697 |
| 0.55 | 4.1 | 0.5811 |
| 0.6 | 1.2 | 0.5972 |
| 0.6 | 1.4 | 0.5943 |
| 0.6 | 1.6 | 0.5925 |
| 0.6 | 2 | 0.5917 |
| 0.6 | 3 | 0.6018 |
| 0.6 | 4.1 | 0.6263 |
| 0.65 | 1.2 | 0.6089 |
| 0.65 | 1.4 | 0.6087 |
| 0.65 | 1.6 | 0.6098 |
| 0.65 | 2 | 0.615 |
| 0.65 | 3 | 0.6417 |
| 0.65 | 4.1 | 0.6858 |

- verdict: **keep-current (refit lowers log-loss only by hedging)**

## Misses

| Probe | Conditions | Shown top match | Raw rank of truth |
| :--- | :--- | :--- | ---: |
| adele (001) | — | katie-cassidy | 6 |
| angelina-jolie (001) | — | jason-momoa | 223 |
| anya-taylor-joy (001) | — | kylian-mbappe | 295 |
| doja-cat (001) | yaw-gt-25 | travis-scott | 13 |
| donald-glover (001) | low-light | hugh-jackman | 53 |
| donnie-yen (001) | yaw-gt-25 | hugh-jackman | 44 |
| fan-bingbing (001) | big-smile | jennie-kim | 124 |
| gigi-hadid (001) | — | andrea-frankle | 3 |
| harry-styles (001) | low-light, big-smile | bruno-mars | 24 |
| helena-bonham-carter (001) | low-light, big-smile | regina-king | 588 |
| jennifer-lawrence (001) | — | ritchie-montgomery | 185 |
| julia-roberts (001) | yaw-gt-25 | sarah-jane-redmond | 275 |
| kate-middleton (001) | big-smile, yaw-gt-25 | jeffrey-nordling | 11 |
| kendall-jenner (001) | low-light, yaw-gt-25 | travis-scott | 382 |
| kendrick-lamar (001) | yaw-gt-25 | chadwick-boseman | 2 |
| kim-kardashian (001) | — | luke-hemsworth | 108 |
| kylian-mbappe (001) | big-smile, yaw-gt-25 | simon-chin | 69 |
| leonardo-dicaprio (001) | — | will-smith | 6 |
| meghan-markle (001) | yaw-gt-25 | jennie-kim | 65 |
| meryl-streep (001) | big-smile | elizabeth-olsen | 311 |
| naomi-campbell (001) | low-light | billie-eilish | 302 |
| natalie-portman (001) | big-smile, yaw-gt-25 | rey-lucas | 263 |
| neymar (001) | big-smile | kylian-mbappe | 346 |
| oprah-winfrey (001) | — | ian-butcher | 157 |
| prince-harry (001) | big-smile | ana-de-armas | 2 |
| priyanka-chopra (001) | — | shah-rukh-khan | 314 |
| saoirse-ronan (001) | low-light | danny-dworkis | 412 |
| sebastian-stan (001) | — | lana-condor | 286 |
| serena-williams (001) | low-light, big-smile | sza | 9 |
| shah-rukh-khan (001) | — | aishwarya-rai | 676 |

…and 6 more (see the JSON).

## Reproduce

```bash
node --experimental-strip-types scripts/label-hard-probes.mjs --concurrency 4
node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency 4
```
