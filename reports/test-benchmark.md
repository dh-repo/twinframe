# Twinframe Ground-Truth Accuracy Benchmark Report

**Generated**: 2026-08-14T14:43:20.645Z  
**Platform**: darwin-arm64 (Node.js v25.8.0)  
**Enrolled Gallery**: 1000 celebrities  
**Ground-Truth Catalog**: 268 high-resolution portraits  

---

## 1. Benchmark Summary Table

| Evaluation Tier | Probes | Detection Rate | Top-1 Accuracy | Top-5 Accuracy | MRR | Positive Margin % |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Tier 1: Frontal Portraits** | 5 | 100.0% | **100.0%** | **100.0%** | 1.0000 | 80.0% |
| **Tier 2: Moderate Variations** | 5 | 100.0% | **100.0%** | **100.0%** | 1.0000 | 80.0% |
| **Overall Combined** | 10 | 100.0% | **100.0%** | **100.0%** | 1.0000 | 80.0% |

---

## 2. Cosine Similarity Margin Analysis (Tier 3)

$$\Delta s = s_{\text{true}} - \max_{j \neq \text{true}} s_j$$

| Metric | Value |
| :--- | :---: |
| **Analyzed Probes** | 10 |
| **Positive Margin Count ($\Delta s > 0$)** | 8 (80.0%) |
| **Zero-Margin Collisions (Synthetic Clones)** | 2 (20.0%) |
| **Mean Cosine Margin** | 0.0459 ± 0.0232 |
| **Median (P50) Margin** | 0.0554 |
| **Min Margin / Max Margin** | 0.0000 / 0.0644 |

---

## 3. Pipeline Latency Breakdown

| Pipeline Stage | Mean | Min | P50 (Median) | P90 | P99 | Max |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Face Detection ($t_{\text{det}}$)** | 3236.1 ms | 2979.9 ms | 3380.3 ms | 3735.8 ms | 3735.8 ms | 3735.8 ms |
| **2. Landmark Align ($t_{\text{align}}$)** | 802.9 ms | 743.6 ms | 849.2 ms | 876.7 ms | 876.7 ms | 876.7 ms |
| **3. Feature Extract ($t_{\text{emb}}$)** | 2846.7 ms | 2636.3 ms | 3010.7 ms | 3108.3 ms | 3108.3 ms | 3108.3 ms |
| **4. Gallery Match ($t_{\text{match}}$)** | 0.55 ms | 0.48 ms | 0.51 ms | 0.82 ms | 0.82 ms | 0.82 ms |
| **Total End-to-End ($t_{\text{total}}$)** | **6886.3 ms** | 6374.5 ms | **7274.7 ms** | 7637.4 ms | 7637.4 ms | 7637.4 ms |

---

## 4. Key Findings & Milestone Context

1. **Ground-Truth Harness Operational**: The benchmark harness automatically catalogs the 268 ground-truth portraits and executes full multi-stage detection, landmark alignment, feature extraction, and candidate ranking.
2. **Identification of Synthetic Identity Collisions**: The harness successfully detects and quantifies zero-margin identical matches caused by the 65 cloned thumbnails in the gallery catalog.
3. **Reproducibility**: Baseline accuracy and latency metrics are objectively measured and exportable to JSON and Markdown.
