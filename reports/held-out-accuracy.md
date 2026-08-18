# Twinframe held-out accuracy (stratified)

**Generated** 2026-08-18T04:44:29.078Z  
**Engine** EdgeFace-512 + SCRFD-2.5G (shipping AFv4 gallery + 627 extra templates)  
**Gallery** 1848 vectors / 999 identities (848 of them extra templates and centroids, as the browser builds it)  
**Probes** 205 held-out photos (slot 001 only)  

Held-out means the photo was never enrolled: a different Wikipedia/Commons image of the same person. Age and gender priors are passed as unknown, because feeding the query the true celebrity's own age and gender leaks the label. Refusals — the product declining to show any match — count as misses.

## Headline

| Cohort | Probes | Rank-1 | 95% CI | Rank-5 | Refused |
| :--- | ---: | ---: | :---: | ---: | ---: |
| **Held out for real** (near-duplicates removed) | 144 | **75%** | 67.3–81.4% | 78.5% | 0% |
| Every probe on disk (leakage included) | 205 | 82.4% | 76.6–87% | 84.9% | 0% |

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
| No condition fired | 46 | 67.4% | 53–79.1% | 71.7% | 67.4% | 0% | derived |

All probes on disk, leakage included:

| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |
| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |
| Low light | 18 | 55.6% | 33.7–75.4% | 61.1% | 55.6% | 0% | auto (SCRFD geometry) |
| Glasses | 0 | — | — | — | — | — | manual labels only |
| Big smile | 122 | 91% | 84.6–94.9% | 92.6% | 91% | 0% | auto (low-confidence proxy) |
| Yaw > 25° | 39 | 74.4% | 58.9–85.4% | 76.9% | 74.4% | 0% | auto (SCRFD geometry) |
| Phone close-up | 0 | — | — | — | — | — | auto (SCRFD geometry) |
| No condition fired | 57 | 73.7% | 61–83.4% | 77.2% | 73.7% | 0% | derived |

Cohorts overlap — a probe can be dark and turned away at once — and every cohort is a subset of the same held-out set, so the strata are not independent samples.

Empty cohorts, and why:

- **Glasses** — no labelled image carries it. Provenance: manual labels only.
- **Phone close-up** — 8 labelled images do carry it, but none are held-out probes (they are enrolled slots 002+), so this protocol has nothing to score.

## Distance distributions

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 205 | 0.3314 | 0.0034 | 0.3209 | 0.8251 |
| impostor (probe → best other identity) | 205 | 0.5867 | 0.5119 | 0.6038 | 0.6634 |

Near-duplicates removed:

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 144 | 0.4694 | 0.2278 | 0.4165 | 0.8858 |
| impostor (probe → best other identity) | 144 | 0.5827 | 0.5077 | 0.6018 | 0.6639 |

## Hill calibration (HILL_D0 / HILL_N)

Fitted by minimising the log-loss of "is the top match the right person?" over genuine vs best-impostor distances (a 1:1 sample, matching the question the UI asks).

**Near-duplicates removed (use this one)**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.7265
- best fit: `HILL_D0 = 0.5`, `HILL_N = 2.5` — log-loss 0.671
- equal-error distance 0.5678 at 26.39% error
- expected calibration error: current **8.26 pts**, best fit 18.79 pts (probe-weighted mean gap between claimed and observed)

Reliability of the displayed percentage — what the curve claims versus how often the top match was actually the right person:

| Claimed band | n | mean claimed | observed correct | overstatement (current) | overstatement (fitted) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 20-40% | 4 | 37.8% | 0% | +37.8 pts | +24.7 pts over 19 |
| 40-60% | 26 | 49.9% | 26.9% | +23 pts | -18.6 pts over 42 |
| 60-80% | 30 | 71.8% | 76.7% | -4.9 pts | -21.8 pts over 52 |
| 80-95% | 50 | 88.8% | 92% | -3.2 pts | -8.8 pts over 26 |
| 95-100% | 34 | 98% | 94.1% | +3.9 pts | +18.6 pts over 5 |

The two overstatement columns are not the same probes: refitting moves each probe into a different claimed band, so compare the size of the errors, not the rows.

Log-loss and calibration disagree here, and calibration is the one the user experiences. The best-fit curve wins on log-loss by flattening every percentage toward the middle, which trades a small gain in the confident bands for a much larger understatement in the middle ones.

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.6943 |
| 0.55 | 1.4 | 0.6884 |
| 0.55 | 1.6 | 0.6838 |
| 0.55 | 2 | 0.6778 |
| 0.55 | 3 | 0.6785 |
| 0.55 | 4.1 | 0.6978 |
| 0.6 | 1.2 | 0.6986 |
| 0.6 | 1.4 | 0.694 |
| 0.6 | 1.6 | 0.6908 |
| 0.6 | 2 | 0.6881 |
| 0.6 | 3 | 0.6976 |
| 0.6 | 4.1 | 0.7265 |
| 0.65 | 1.2 | 0.7048 |
| 0.65 | 1.4 | 0.7022 |
| 0.65 | 1.6 | 0.7012 |
| 0.65 | 2 | 0.7034 |
| 0.65 | 3 | 0.7269 |
| 0.65 | 4.1 | 0.7728 |

- verdict: **keep-current (refit lowers log-loss only by hedging)**

**All probes, leakage included**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.6238
- best fit: `HILL_D0 = 0.45`, `HILL_N = 2.9` — log-loss 0.5397
- equal-error distance 0.5536 at 19.51% error
- expected calibration error: current **5.8 pts**, best fit 11.77 pts (probe-weighted mean gap between claimed and observed)

Reliability of the displayed percentage — what the curve claims versus how often the top match was actually the right person:

| Claimed band | n | mean claimed | observed correct | overstatement (current) | overstatement (fitted) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 20-40% | 4 | 37.8% | 0% | +37.8 pts | -2.3 pts over 36 |
| 40-60% | 26 | 49.9% | 26.9% | +23 pts | -32.8 pts over 36 |
| 60-80% | 30 | 71.8% | 76.7% | -4.9 pts | -20.4 pts over 41 |
| 80-95% | 50 | 88.8% | 92% | -3.2 pts | -9 pts over 25 |
| 95-100% | 95 | 99.3% | 97.9% | +1.4 pts | +1.3 pts over 67 |

The two overstatement columns are not the same probes: refitting moves each probe into a different claimed band, so compare the size of the errors, not the rows.

Log-loss and calibration disagree here, and calibration is the one the user experiences. The best-fit curve wins on log-loss by flattening every percentage toward the middle, which trades a small gain in the confident bands for a much larger understatement in the middle ones.

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.5859 |
| 0.55 | 1.4 | 0.5806 |
| 0.55 | 1.6 | 0.5764 |
| 0.55 | 2 | 0.5707 |
| 0.55 | 3 | 0.5681 |
| 0.55 | 4.1 | 0.579 |
| 0.6 | 1.2 | 0.5965 |
| 0.6 | 1.4 | 0.5934 |
| 0.6 | 1.6 | 0.5915 |
| 0.6 | 2 | 0.5905 |
| 0.6 | 3 | 0.6 |
| 0.6 | 4.1 | 0.6238 |
| 0.65 | 1.2 | 0.6081 |
| 0.65 | 1.4 | 0.6078 |
| 0.65 | 1.6 | 0.6087 |
| 0.65 | 2 | 0.6137 |
| 0.65 | 3 | 0.6397 |
| 0.65 | 4.1 | 0.6829 |

- verdict: **keep-current (refit lowers log-loss only by hedging)**

## Misses

| Probe | Conditions | Shown top match | Raw rank of truth |
| :--- | :--- | :--- | ---: |
| adele (001) | — | katie-cassidy | 6 |
| angelina-jolie (001) | — | jason-momoa | 217 |
| anya-taylor-joy (001) | — | kylian-mbappe | 286 |
| doja-cat (001) | yaw-gt-25 | travis-scott | 10 |
| donald-glover (001) | low-light | hugh-jackman | 51 |
| donnie-yen (001) | yaw-gt-25 | hugh-jackman | 42 |
| fan-bingbing (001) | big-smile | jennie-kim | 118 |
| gigi-hadid (001) | — | andrea-frankle | 3 |
| harry-styles (001) | low-light, big-smile | bruno-mars | 22 |
| helena-bonham-carter (001) | low-light, big-smile | kim-sykes | 574 |
| jennifer-lawrence (001) | — | ritchie-montgomery | 179 |
| julia-roberts (001) | yaw-gt-25 | sarah-jane-redmond | 265 |
| kate-middleton (001) | big-smile, yaw-gt-25 | jeffrey-nordling | 10 |
| kendall-jenner (001) | low-light, yaw-gt-25 | travis-scott | 369 |
| kendrick-lamar (001) | yaw-gt-25 | chadwick-boseman | 2 |
| kim-kardashian (001) | — | luke-hemsworth | 103 |
| kylian-mbappe (001) | big-smile, yaw-gt-25 | simon-chin | 66 |
| leonardo-dicaprio (001) | — | will-smith | 5 |
| meghan-markle (001) | yaw-gt-25 | jennie-kim | 58 |
| meryl-streep (001) | big-smile | elizabeth-olsen | 304 |
| naomi-campbell (001) | low-light | billie-eilish | 289 |
| natalie-portman (001) | big-smile, yaw-gt-25 | rey-lucas | 254 |
| neymar (001) | big-smile | kylian-mbappe | 333 |
| oprah-winfrey (001) | — | ian-butcher | 150 |
| prince-harry (001) | big-smile | ana-de-armas | 2 |
| priyanka-chopra (001) | — | shah-rukh-khan | 304 |
| saoirse-ronan (001) | low-light | danny-dworkis | 397 |
| sebastian-stan (001) | — | naomi-osaka | 278 |
| serena-williams (001) | low-light, big-smile | seth-rogen | 8 |
| shah-rukh-khan (001) | — | aishwarya-rai | 667 |

…and 6 more (see the JSON).

## Reproduce

```bash
node --experimental-strip-types scripts/label-hard-probes.mjs --concurrency 4
node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency 2
```
