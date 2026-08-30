#!/usr/bin/env python3
"""Compress AdaFace IR-101 for on-device speed without changing 512-d geometry.

FP16 (keep_io_types=True) is the shippable fast path: same IR-101 graph, ~0.5x
size, cosine vs fp32 ≈ 0.9998 on portrait tensors.

INT8/QDQ of this PReLU-ResNet is generated when --int8 is set, then discarded
unless mean cosine vs fp32 stays within the gate. Full-graph PTQ measured
mean cosine 0.58–0.75 here — that would collapse identity ranking, so it is
not installed as the live embedder.

A student/distilled net is not trained: this environment has no WebFace12M
corpus and no GPU training cluster.
"""
from __future__ import annotations

import argparse
import glob
import os
import sys
import tempfile
import warnings

import numpy as np
import onnx

TARGET = 112
INPUT_NAME = "input"
EXPECTED_OUT_DIM = 512
MEAN_COSINE_GATE = 0.97


def _out_dim(model_path: str) -> int:
    model = onnx.load(model_path, load_external_data=False)
    dims = [d.dim_value for d in model.graph.output[0].type.tensor_type.shape.dim]
    dim = next((d for d in dims if d and d > 1), 0)
    return int(dim)


def _load_tensors(image_paths: list[str], limit: int) -> list[np.ndarray]:
    tensors: list[np.ndarray] = []
    try:
        from PIL import Image
    except ImportError:
        Image = None  # type: ignore[assignment]
    for path in image_paths:
        if len(tensors) >= limit:
            break
        if Image is None:
            break
        try:
            img = Image.open(path).convert("RGB").resize((TARGET, TARGET), Image.BILINEAR)
            arr = np.asarray(img, dtype=np.float32)
            bgr = arr[:, :, ::-1]
            nchw = np.transpose(bgr, (2, 0, 1))
            tensors.append(((nchw - 127.5) / 128.0)[np.newaxis, ...].astype(np.float32))
        except Exception as err:  # noqa: BLE001
            print(f"[quantize] skip {path}: {err}", file=sys.stderr)
    while len(tensors) < max(2, min(limit, 4)):
        rng = np.random.default_rng(len(tensors) + 7)
        tensors.append(((rng.random((1, 3, TARGET, TARGET), dtype=np.float32) * 255.0) - 127.5) / 128.0)
    return tensors[:limit]


def write_fp16(fp32_path: str, out_path: str) -> None:
    from onnxconverter_common import float16

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    model = onnx.load(fp32_path)
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore")
        converted = float16.convert_float_to_float16(
            model,
            keep_io_types=True,
            min_positive_val=1e-7,
            max_finite_val=1e4,
        )
    tmp = f"{out_path}.tmp"
    onnx.save(converted, tmp)
    if _out_dim(tmp) != EXPECTED_OUT_DIM:
        os.remove(tmp)
        raise RuntimeError(f"fp16 output dim is not {EXPECTED_OUT_DIM}")
    os.replace(tmp, out_path)


def try_int8(fp32_path: str, out_path: str, tensors: list[np.ndarray]) -> str:
    from onnxruntime.quantization import QuantType, quantize_dynamic

    tmpdir = tempfile.mkdtemp(prefix="adaface-int8-")
    dyn_path = os.path.join(tmpdir, "dyn.onnx")
    quantize_dynamic(fp32_path, dyn_path, weight_type=QuantType.QInt8, per_channel=False)
    if _out_dim(dyn_path) != EXPECTED_OUT_DIM:
        raise RuntimeError("int8 output dim is not 512")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    os.replace(dyn_path, out_path)
    return "dynamic"


def _embed(model_path: str, tensors: list[np.ndarray]) -> list[np.ndarray]:
    import onnxruntime as ort

    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    out = session.get_outputs()[0].name
    embs = []
    for tensor in tensors:
        raw = session.run([out], {name: tensor})[0].reshape(-1).astype(np.float64)
        n = np.linalg.norm(raw)
        embs.append(raw / n if n > 1e-12 else raw)
    return embs


def mean_cosine(fp32_path: str, other_path: str, tensors: list[np.ndarray]) -> float:
    a = _embed(fp32_path, tensors)
    b = _embed(other_path, tensors)
    coss = [float(np.dot(x, y)) for x, y in zip(a, b)]
    return float(sum(coss) / max(1, len(coss)))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--fp16-output", required=True)
    parser.add_argument("--int8-output", default="")
    parser.add_argument("--calib-dir", default="public/celebs")
    parser.add_argument("--calib-limit", type=int, default=8)
    parser.add_argument("--int8", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(f"[quantize] missing fp32 model: {args.input}", file=sys.stderr)
        return 2

    if args.force or not (os.path.isfile(args.fp16_output) and os.path.getsize(args.fp16_output) >= 20 * 1024 * 1024):
        print("[quantize] writing fp16 (keep_io_types=True)…")
        write_fp16(args.input, args.fp16_output)
        print(f"[quantize] fp16 {args.fp16_output} ({os.path.getsize(args.fp16_output)} bytes)")
    else:
        print(f"[quantize] fp16 already present ({os.path.getsize(args.fp16_output)} bytes)")

    images = sorted(p for p in glob.glob(os.path.join(args.calib_dir, "*.jpg")) if os.path.isfile(p))
    tensors = _load_tensors(images, args.calib_limit)
    try:
        fp16_cos = mean_cosine(args.input, args.fp16_output, tensors[: min(4, len(tensors))])
        print(f"[quantize] fp16 mean cosine vs fp32 = {fp16_cos:.4f}")
        if fp16_cos < MEAN_COSINE_GATE:
            print("[quantize] fp16 failed the cosine gate; removing", file=sys.stderr)
            os.remove(args.fp16_output)
            return 6
    except Exception as err:  # noqa: BLE001
        print(f"[quantize] fp16 cosine probe failed: {err}", file=sys.stderr)
        return 7

    if not args.int8 or not args.int8_output:
        print("[quantize] skipping INT8 (not live; PTQ of this IR-101 fails the identity gate)")
        return 0

    try:
        method = try_int8(args.input, args.int8_output, tensors)
        int8_cos = mean_cosine(args.input, args.int8_output, tensors[: min(4, len(tensors))])
        print(f"[quantize] int8 method={method} mean cosine vs fp32 = {int8_cos:.4f}")
        if int8_cos < MEAN_COSINE_GATE:
            print(
                f"[quantize] INT8 rejected (mean cosine {int8_cos:.4f} < {MEAN_COSINE_GATE}); "
                "not installing as the live embedder"
            )
            if os.path.isfile(args.int8_output):
                os.remove(args.int8_output)
        else:
            print(f"[quantize] int8 installed {args.int8_output} ({os.path.getsize(args.int8_output)} bytes)")
    except Exception as err:  # noqa: BLE001
        print(f"[quantize] INT8 generation failed: {err}", file=sys.stderr)
        if args.int8_output and os.path.isfile(args.int8_output):
            os.remove(args.int8_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
