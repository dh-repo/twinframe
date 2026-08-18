# Twinframe Ground-Truth Accuracy Benchmark Report

**Generated**: 2026-08-18T05:04:06.844Z  
**Platform**: linux-x64 (Node.js v22.14.0)  
**Enrolled Gallery**: 1000 celebrities  
**Ground-Truth Catalog**: 270 probes (root-jpg: 270)  

---

## 1. Benchmark Summary Table

| Evaluation Tier | Probes | Detection Rate | Top-1 Accuracy | Top-5 Accuracy | MRR | Positive Margin % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tier 1: Frontal Portraits** | 270 | 99.6% | **96.7%** | **96.7%** | 0.9670 | 97.0% |
| **Overall Combined** | 270 | 99.6% | **96.7%** | **96.7%** | 0.9670 | N/A |

---

## 1b. Tier 1 by probe rendition — and what Tier 1 actually measures

Every probe here is an enrolled image. `collectEnrollJobs` takes each identity's
primary template from `public/celebs/<id>.jpg` when it exists and from a PNG decode of
`thumbs/192/<id>.webp` otherwise, which are the same two files this harness uses as
probes. **Tier 1 therefore measures whether the engine recognizes its own enrollment
photo — a self-recognition and enrollment-integrity check, not accuracy on an unseen
photo.** A miss here means something is broken in the gallery, not that the model is
weak. For accuracy on a photo the engine has never seen, read
`reports/held-out-accuracy.md`.

Only 271 of the 1000 catalog ids ship a full-size portrait, so root JPGs are the default
probe set; `--probe-sources all` falls back to the thumbnails for the rest.

| Probe Source | Relation to Enrollment | Probes | Detection Rate | Top-1 | Top-5 |
| :--- | :--- | ---: | ---: | ---: | ---: |
| root-jpg | enrolled photo | 270 | 99.6% | **96.7%** | 96.7% |

---

## 1c. Tier 1 by gallery enrollment

Growing the probe set cannot grow Tier 1 past the gallery it scores against. This harness
scores the legacy FaceNet-128 gallery `public/celebs/embeddings.json`, and only
265 of its 1000 descriptors are real face
embeddings: they cluster tightly around a shared mean direction (alignment 0.82-0.95, as
FaceNet descriptors do), while the other 735 are random unit
vectors with alignment in ±0.31 and pairwise cosine ~0.00. Those identities were never
enrolled, so their probes rank the true identity in the hundreds no matter how clean the
photo is. They measure missing data, not recognition quality.

| Cohort | Probes | Detection Rate | Top-1 | Top-5 |
| :--- | ---: | ---: | ---: | ---: |
| identity enrolled | 265 | 100.0% | **98.5%** | 98.5% |
| identity **never enrolled** | 5 | 80.0% | **0.0%** | 0.0% |

Quote the enrolled row. Scaling honest accuracy toward all 1000 identities needs the
product EdgeFace-512 gallery (`embeddings.v4.q8.bin`, whose 1000 vectors are all real) —
`scripts/evaluate-held-out.ts` is the harness that scores it.

---

## 3. Pipeline Latency Breakdown

| Pipeline Stage | Mean | Min | P50 (Median) | P90 | P99 | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Face Detection ($t_{\text{det}}$)** | 21859.6 ms | 5462.1 ms | 21162.8 ms | 25545.7 ms | 30275.9 ms | 30278.7 ms |
| **2. Landmark Align ($t_{\text{align}}$)** | 771.5 ms | 192.8 ms | 746.9 ms | 901.6 ms | 1068.6 ms | 1068.7 ms |
| **3. Feature Extract ($t_{\text{emb}}$)** | 3086.1 ms | 771.1 ms | 2987.7 ms | 3606.5 ms | 4274.2 ms | 4274.6 ms |
| **4. Gallery Match ($t_{\text{match}}$)** | 0.58 ms | 0.35 ms | 0.47 ms | 0.74 ms | 3.45 ms | 6.02 ms |
| **Total End-to-End ($t_{\text{total}}$)** | **25717.8 ms** | 6426.5 ms | **24897.9 ms** | 30054.4 ms | 35619.1 ms | 35622.6 ms |

---

## 4. Key Findings & Milestone Context

1. **Ground-Truth Harness Operational**: The benchmark harness automatically catalogs the 268 ground-truth portraits and executes full multi-stage detection, landmark alignment, feature extraction, and candidate ranking.
2. **Identification of Synthetic Identity Collisions**: The harness successfully detects and quantifies zero-margin identical matches caused by the 65 cloned thumbnails in the gallery catalog.
3. **Reproducibility**: Baseline accuracy and latency metrics are objectively measured and exportable to JSON and Markdown.
