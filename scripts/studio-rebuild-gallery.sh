#!/bin/sh
# One-shot Mac Studio gallery rebuild after gallery-review.json is filled.
# Default is a dry plan. Pass --write to run. Never invents embeddings.
set -eu
cd "$(dirname "$0")/.."

WRITE=0
CONCURRENCY="${CONCURRENCY:-16}"
for arg in "$@"; do
  case "$arg" in
    --write) WRITE=1 ;;
    --concurrency)
      echo "use CONCURRENCY=N $0 --write" >&2
      exit 2
      ;;
    --concurrency=*)
      CONCURRENCY="${arg#--concurrency=}"
      ;;
    *)
      echo "Usage: $0 [--write]   (optional CONCURRENCY=N, default 16)" >&2
      exit 2
      ;;
  esac
done

echo "================================================================================"
echo "          TWINFRAME STUDIO GALLERY REBUILD                                      "
echo "================================================================================"
echo "1. apply-gallery-review.mjs --write   (catalog only; drops typo clones)"
echo "2. enroll-gallery-onnx.mjs --concurrency ${CONCURRENCY}"
echo "3. write-gallery-v4.mjs               (rewrites embeddings.v4.q8.bin)"
echo "4. audit-gallery-v4.mjs"
echo "5. evaluate-open-set-loo.mjs --json"
echo "6. evaluate-lookalike-gold.mjs"
echo

node --experimental-strip-types scripts/apply-gallery-review.mjs

if [ "$WRITE" -eq 0 ]; then
  echo
  echo "Dry plan. On the Mac Studio run:"
  echo "  CONCURRENCY=${CONCURRENCY} sh scripts/studio-rebuild-gallery.sh --write"
  echo "Do not run --write in a CPU-only cloud VM (enroll takes hours; binary would desync if enroll fails)."
  exit 0
fi

echo
echo "Applying catalog drops, then full enroll + binary write..."
node --experimental-strip-types scripts/apply-gallery-review.mjs --write
node --experimental-strip-types scripts/enroll-gallery-onnx.mjs --concurrency "$CONCURRENCY"
node scripts/write-gallery-v4.mjs
node --experimental-strip-types scripts/audit-gallery-v4.mjs
node --experimental-strip-types scripts/evaluate-open-set-loo.mjs --json
node --experimental-strip-types scripts/evaluate-lookalike-gold.mjs
echo
echo "Studio rebuild finished. Compare LOO strong-band to the 109/968 baseline."
echo "If civilian gold photos exist, record acceptable@1 / refuse_ok / calibration(>=70% endorsed)."
echo "Do not retune Hill / margin / gender until those gold numbers exist."
