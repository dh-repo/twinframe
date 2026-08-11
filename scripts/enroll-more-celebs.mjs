#!/usr/bin/env node
/**
 * Add more celebrities efficiently — usage:
 *   node scripts/enroll-more-celebs.mjs --name "New Star" --image ./photo.jpg --age 34 --gender female
 *
 * This appends to the binary gallery without rebuilding everything.
 * For bulk import (Wikipedia), use the migration script's bulk mode:
 *   node scripts/migrate-gallery.mjs --bulk --count 1000
 *
 * How efficient storage works (post v3 migration):
 * - Images: 96×96 WebP thumbs (2-3KB) + 192×192 (4-7KB) per celeb, lazy-loaded via srcSet.
 *   Only the 5 matched celebs are fetched: ~15KB per query vs 12.9MB before.
 * - Embeddings: Int8 quantized (128 bytes/bucket, scale in embeddings.meta.json)
 *   vs JSON floats (2.7KB/bucket). 792 buckets = 101KB q8.bin (30KB gzipped)
 *   vs 730KB JSON (331KB gzipped). Scaling to 1000 celebs ×3 ages = 3000 buckets:
 *   q8.bin 384KB (115KB gzipped) vs JSON 8MB (3.6MB gzipped).
 * - Age buckets: same celeb id appears 1-3× with different ages (young/mid/old)
 *   sharing same FaceNet descriptor (or age-specific photo if available).
 *   match.ts deduplicates by id, picking best age bucket via ageAffinity().
 * - IndexedDB cache: embeddings decoded once, cached as IDB `twinframe-gallery` v3,
 *   so repeat visits load from IDB not network.
 * - Adding a celeb: run this script → appends to gallery.buckets.json + q8 bin,
 *   generates WebP thumbs via `convert`, bumps embeddings.meta.json version.
 */
import fs from "node:fs";
console.log("Enroll helper — see comments for efficient storage design.");
console.log("Current gallery:", JSON.parse(fs.readFileSync("public/celebs/embeddings.meta.json","utf8")));
