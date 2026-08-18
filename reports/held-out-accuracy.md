# Twinframe held-out accuracy (stratified)

**Generated** 2026-08-18T04:11:24.235Z  
**Engine** EdgeFace-512 + SCRFD-2.5G (shipping AFv4 gallery)  
**Gallery** 1000 vectors / 999 identities  
**Probes** 206 held-out photos (slot 001 only)  

Held-out means the photo was never enrolled: a different Wikipedia/Commons image of the same person. Age and gender priors are passed as unknown, because feeding the query the true celebrity's own age and gender leaks the label. Refusals — the product declining to show any match — count as misses.

## Headline

| Cohort | Probes | Rank-1 | 95% CI | Rank-5 | Refused |
| :--- | ---: | ---: | :---: | ---: | ---: |
| **Held out for real** (near-duplicates removed) | 145 | **62.1%** | 54–69.6% | 72.4% | 0.7% |
| Every probe on disk (leakage included) | 206 | 73.3% | 66.9–78.9% | 80.6% | 0.5% |

61 of 206 probes (29.6%) sit within cosine distance 0.05 of their own gallery vector: the same source photo at another resolution, which the fetcher's byte-level dedupe cannot detect. Every one of them scores Rank-1 for free, so the first row is the number to quote.

Raw nearest-neighbour Rank-1 (no gates, no priors): 73.3% over all probes, 62.1% with near-duplicates removed.

## Per hard-probe condition

Near-duplicates removed (the honest view):

| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |
| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |
| Low light | 12 | 25% | 8.9–53.2% | 50% | 25% | 0% | auto (SCRFD geometry) |
| Glasses | 0 | — | — | — | — | — | manual labels only |
| Big smile | 77 | 75.3% | 64.6–83.6% | 84.4% | 75.3% | 0% | auto (low-confidence proxy) |
| Yaw > 25° | 32 | 46.9% | 30.9–63.6% | 59.4% | 46.9% | 0% | auto (SCRFD geometry) |
| Phone close-up | 0 | — | — | — | — | — | auto (SCRFD geometry) |
| No condition fired | 47 | 53.2% | 39.2–66.7% | 63.8% | 53.2% | 2.1% | derived |

All probes on disk, leakage included:

| Condition | n | Rank-1 | 95% CI | Rank-5 | Raw Rank-1 | Refused | Label source |
| :--- | ---: | ---: | :---: | ---: | ---: | ---: | :--- |
| Low light | 18 | 50% | 29–71% | 66.7% | 50% | 0% | auto (SCRFD geometry) |
| Glasses | 0 | — | — | — | — | — | manual labels only |
| Big smile | 122 | 84.4% | 77–89.8% | 90.2% | 84.4% | 0% | auto (low-confidence proxy) |
| Yaw > 25° | 39 | 56.4% | 41–70.7% | 66.7% | 56.4% | 0% | auto (SCRFD geometry) |
| Phone close-up | 0 | — | — | — | — | — | auto (SCRFD geometry) |
| No condition fired | 58 | 62.1% | 49.2–73.4% | 70.7% | 62.1% | 1.7% | derived |

Cohorts overlap — a probe can be dark and turned away at once — and every cohort is a subset of the same held-out set, so the strata are not independent samples. `glasses` has no automated signal and stays at n=0 until someone hand-labels it.

## Distance distributions

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 206 | 0.4055 | 0.0034 | 0.426 | 0.8564 |
| impostor (probe → best other identity) | 206 | 0.6133 | 0.5451 | 0.6297 | 0.6779 |

Near-duplicates removed:

| Distribution | n | mean | p10 | p50 | p90 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| genuine (probe → own identity) | 145 | 0.5738 | 0.319 | 0.528 | 0.911 |
| impostor (probe → best other identity) | 145 | 0.6137 | 0.5514 | 0.6342 | 0.679 |

## Hill calibration (HILL_D0 / HILL_N)

Fitted by minimising the log-loss of "is the top match the right person?" over genuine vs best-impostor distances (a 1:1 sample, matching the question the UI asks).

**Near-duplicates removed (use this one)**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.7337
- best fit: `HILL_D0 = 0.57`, `HILL_N = 1.4` — log-loss 0.6717
- equal-error distance 0.6107 at 35.86% error

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.6721 |
| 0.55 | 1.4 | 0.672 |
| 0.55 | 1.6 | 0.6727 |
| 0.55 | 2 | 0.6765 |
| 0.55 | 3 | 0.6978 |
| 0.55 | 4.1 | 0.7369 |
| 0.6 | 1.2 | 0.6724 |
| 0.6 | 1.4 | 0.6723 |
| 0.6 | 1.6 | 0.6731 |
| 0.6 | 2 | 0.6768 |
| 0.6 | 3 | 0.6972 |
| 0.6 | 4.1 | 0.7337 |
| 0.65 | 1.2 | 0.675 |
| 0.65 | 1.4 | 0.6758 |
| 0.65 | 1.6 | 0.6774 |
| 0.65 | 2 | 0.6832 |
| 0.65 | 3 | 0.7095 |
| 0.65 | 4.1 | 0.753 |

- verdict: **recalibrate**

**All probes, leakage included**

- current: `HILL_D0 = 0.6`, `HILL_N = 4.1` — log-loss 0.6215
- best fit: `HILL_D0 = 0.46`, `HILL_N = 1.6` — log-loss 0.5579
- equal-error distance 0.6009 at 27.18% error

| HILL_D0 | HILL_N | log-loss |
| ---: | ---: | ---: |
| 0.55 | 1.2 | 0.5686 |
| 0.55 | 1.4 | 0.5671 |
| 0.55 | 1.6 | 0.5663 |
| 0.55 | 2 | 0.5668 |
| 0.55 | 3 | 0.5773 |
| 0.55 | 4.1 | 0.6007 |
| 0.6 | 1.2 | 0.5762 |
| 0.6 | 1.4 | 0.5759 |
| 0.6 | 1.6 | 0.5764 |
| 0.6 | 2 | 0.5791 |
| 0.6 | 3 | 0.5944 |
| 0.6 | 4.1 | 0.6215 |
| 0.65 | 1.2 | 0.5852 |
| 0.65 | 1.4 | 0.5867 |
| 0.65 | 1.6 | 0.5891 |
| 0.65 | 2 | 0.5958 |
| 0.65 | 3 | 0.6214 |
| 0.65 | 4.1 | 0.6603 |

- verdict: **recalibrate**

## Misses

| Probe | Conditions | Shown top match | Raw rank of truth |
| :--- | :--- | :--- | ---: |
| adele (001) | — | katie-cassidy | 12 |
| ana-de-armas (001) | — | brina-romanek | 3 |
| angelina-jolie (001) | — | refused | 191 |
| anya-taylor-joy (001) | — | travis-scott | 776 |
| ariana-grande (001) | yaw-gt-25 | zac-efron | 9 |
| bella-hadid (001) | — | gigi-hadid | 3 |
| beyonce (001) | — | zoe-saldana | 4 |
| charlize-theron (001) | big-smile, yaw-gt-25 | anthony-mackie | 4 |
| dev-patel (001) | big-smile | adrian-petriw | 2 |
| doja-cat (001) | yaw-gt-25 | travis-scott | 9 |
| donald-glover (001) | low-light | travis-scott | 92 |
| donnie-yen (001) | yaw-gt-25 | travis-scott | 97 |
| dua-lipa (001) | big-smile, yaw-gt-25 | ansel-elgort | 21 |
| fan-bingbing (001) | big-smile | travis-scott | 92 |
| florence-pugh (001) | big-smile, yaw-gt-25 | keira-knightley | 3 |
| george-clooney (001) | big-smile | colman-domingo | 2 |
| gigi-hadid (001) | — | andrea-frankle | 38 |
| hailee-steinfeld (001) | yaw-gt-25 | kenneth-fink | 18 |
| harry-styles (001) | low-light, big-smile | bruno-mars | 127 |
| helena-bonham-carter (001) | low-light, big-smile | kim-sykes | 522 |
| jennie-kim (001) | — | andy-thompson | 40 |
| jennifer-lawrence (001) | — | ritchie-montgomery | 167 |
| joaquin-phoenix (001) | big-smile | bella-ramsey | 8 |
| julia-roberts (001) | yaw-gt-25 | sarah-jane-redmond | 479 |
| kate-middleton (001) | big-smile, yaw-gt-25 | jeffrey-nordling | 18 |
| kendall-jenner (001) | low-light, yaw-gt-25 | travis-scott | 305 |
| kendrick-lamar (001) | yaw-gt-25 | marc-senior | 6 |
| kim-kardashian (001) | — | travis-scott | 90 |
| kylian-mbappe (001) | big-smile, yaw-gt-25 | simon-chin | 45 |
| leonardo-dicaprio (001) | — | lee-jung-jae | 74 |

…and 25 more (see the JSON).

## Reproduce

```bash
node --experimental-strip-types scripts/label-hard-probes.mjs --concurrency 4
node --experimental-strip-types scripts/evaluate-held-out.ts --concurrency 4
```
