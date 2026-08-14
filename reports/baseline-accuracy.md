# Twinframe Ground-Truth Accuracy Benchmark Report

**Generated**: 2026-08-14T14:45:21.840Z  
**Platform**: darwin-arm64 (Node.js v25.8.0)  
**Enrolled Gallery**: 1000 celebrities  
**Ground-Truth Catalog**: 268 high-resolution portraits  

---

## 1. Benchmark Summary Table

| Evaluation Tier | Probes | Detection Rate | Top-1 Accuracy | Top-5 Accuracy | MRR | Positive Margin % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tier 1: Frontal Portraits** | 50 | 100.0% | **100.0%** | **100.0%** | 1.0000 | 78.0% |
| **Tier 2: Moderate Variations** | 50 | 100.0% | **98.0%** | **100.0%** | 0.9900 | 78.0% |
| **Overall Combined** | 100 | 100.0% | **99.0%** | **100.0%** | 0.9950 | 78.0% |

---

## 2. Cosine Similarity Margin Analysis (Tier 3)

$$\Delta s = s_{\text{true}} - \max_{j \neq \text{true}} s_j$$

| Metric | Value |
| :--- | :---: |
| **Analyzed Probes** | 100 |
| **Positive Margin Count ($\Delta s > 0$)** | 78 (78.0%) |
| **Zero-Margin Collisions (Synthetic Clones)** | 21 (21.0%) |
| **Mean Cosine Margin** | 0.0483 ± 0.0280 |
| **Median (P50) Margin** | 0.0584 |
| **Min Margin / Max Margin** | -0.0018 / 0.0957 |

---

## 3. Pipeline Latency Breakdown

| Pipeline Stage | Mean | Min | P50 (Median) | P90 | P99 | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Face Detection ($t_{\text{det}}$)** | 3018.8 ms | 2779.5 ms | 2934.2 ms | 3327.4 ms | 3444.2 ms | 3444.2 ms |
| **2. Landmark Align ($t_{\text{align}}$)** | 106.5 ms | 98.1 ms | 103.6 ms | 117.4 ms | 121.6 ms | 121.6 ms |
| **3. Feature Extract ($t_{\text{emb}}$)** | 426.2 ms | 392.4 ms | 414.2 ms | 469.8 ms | 486.2 ms | 486.2 ms |
| **4. Gallery Match ($t_{\text{match}}$)** | 0.44 ms | 0.39 ms | 0.42 ms | 0.52 ms | 0.83 ms | 0.83 ms |
| **Total End-to-End ($t_{\text{total}}$)** | **3552.0 ms** | 3270.4 ms | **3452.4 ms** | 3915.0 ms | 4052.4 ms | 4052.4 ms |

---

## 4. Key Findings & Milestone Context

1. **Ground-Truth Harness Operational**: The benchmark harness automatically catalogs the 268 ground-truth portraits and executes full multi-stage detection, landmark alignment, feature extraction, and candidate ranking.
2. **Identification of Synthetic Identity Collisions**: The harness successfully detects and quantifies zero-margin identical matches caused by the 65 cloned thumbnails in the gallery catalog.
3. **Reproducibility**: Baseline accuracy and latency metrics are objectively measured and exportable to JSON and Markdown.
