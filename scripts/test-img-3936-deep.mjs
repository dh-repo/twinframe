import { chromium } from "playwright";
import { copyFileSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "/Users/damian/Downloads/IMG_3936.jpeg";
const OUT = join(process.cwd(), "screenshots", "img-3936-extended");
const PUBLIC_IMG = join(process.cwd(), "public", "_tmp_img_3936.jpeg");
mkdirSync(OUT, { recursive: true });
copyFileSync(SRC, join(OUT, "IMG_3936.jpeg"));
copyFileSync(SRC, PUBLIC_IMG);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function serializeResult(r) {
  if (!r) return null;
  const matches = (r.matches || []).map((m, i) => ({
    rank: i + 1,
    id: m.celebrityId,
    name: m.name,
    matchPercent: m.matchPercent,
    distance: m.distance,
    confidenceScore: m.confidenceScore,
    passedLookalikeGate: m.passedLookalikeGate,
    ethnicCluster: m.ethnicCluster,
    knownFor: m.knownFor,
    deep: m.matchScoreResult?.deepVectorDistance,
    morph: m.matchScoreResult?.morphologicalDistance,
    descriptorDistance: m.matchScoreResult?.descriptorDistance,
    scoreConfidence: m.matchScoreResult?.confidencePct,
  }));
  const percents = matches.map((m) => m.matchPercent);
  const monotonic = percents.every((p, i) => i === 0 || percents[i - 1] >= p);
  return {
    engineVersion: r.engineVersion,
    estimatedAge: r.estimatedAge,
    estimatedGender: r.estimatedGender,
    quality: r.quality,
    occlusion: r.occlusion,
    landmarkCount: r.croppedLandmarks?.length ?? 0,
    candidateCount: r.candidateBoxes?.length ?? r.candidates?.length ?? 0,
    candidateBoxes: (r.candidateBoxes || []).map((b) => ({
      x: +b.x.toFixed(4),
      y: +b.y.toFixed(4),
      w: +b.width.toFixed(4),
      h: +b.height.toFixed(4),
      isPrimary: Boolean(b.isPrimary),
    })),
    telemetry: r.telemetry ?? null,
    features: r.features
      ? {
          faceAspect: r.features.faceAspect,
          jawWidth: r.features.jawWidth,
          eyeSpacing: r.features.eyeSpacing,
          eyeOpenness: r.features.eyeOpenness,
          noseWidth: r.features.noseWidth,
          mouthWidth: r.features.mouthWidth,
          lipFullness: r.features.lipFullness,
          youthfulness: r.features.youthfulness,
          feminine: r.features.feminine,
          masculine: r.features.masculine,
          hairL: r.features.hairL,
          skinL: r.features.skinL,
          anatomical: r.features.anatomical ?? null,
        }
      : null,
    pose: r._pose ?? null,
    matches,
    percentsMonotonicWithRank: monotonic,
  };
}

async function waitForResults(page, label, maxSec = 90) {
  for (let i = 0; i < maxSec; i++) {
    const text = await page.locator("body").innerText();
    // Weak cards use CLOSEST AVAILABLE MATCH / NO STRONG DOUBLE (MatchRevealCard).
    if (
      /SIMILARITY|look-alike|No close|No face|nearest in the gallery|NEAREST|CLOSEST AVAILABLE|NO STRONG DOUBLE|NOT A STRONG MATCH|OTHER NEAREST|Match Found|STRONG VISUAL RESEMBLANCE/i.test(
        text,
      ) &&
      !/Analyzing|Choose a face|Loading face model/i.test(text)
    ) {
      console.log(`[${label}] results after ${i}s`);
      return text;
    }
    if (/timed out|Something went wrong|Could not/i.test(text) && i > 8) {
      console.log(`[${label}] error UI after ${i}s`);
      return text;
    }
    await sleep(1000);
  }
  return page.locator("body").innerText();
}

/** Weak path still shows inspect chrome; share twin card is soft/strong only. */
function summarizeResultsUi(bodyText, landmarksTabCount, sideBySideCount) {
  const honestyWeak =
    /CLOSEST AVAILABLE MATCH|NO STRONG DOUBLE|NEAREST GALLERY NEIGHBOR|NOT A STRONG MATCH|NO CLOSE LOOK-ALIKE/i.test(
      bodyText,
    );
  const qualityNotePresent =
    /blur|dark|bright|angle|partial|occlu|low quality|hard to match|lighting|face is small|too close|cover|mask|glasses/i.test(
      bodyText,
    );
  // ShareCard renders Share + Download + Copy text CTAs (hidden when top is weak).
  const shareCardPresent =
    /\bShare\b/.test(bodyText) &&
    /\bDownload\b/.test(bodyText) &&
    /Copy text/i.test(bodyText);
  return {
    honestyWeak,
    landmarksTabPresent: landmarksTabCount > 0,
    comparisonTabsPresent: sideBySideCount > 0,
    qualityNotePresent,
    shareCardPresent,
    // F3+F5: weak matches keep Landmarks / Comparison; hide share twin chrome.
    expectLandmarksWhenWeak: honestyWeak ? landmarksTabCount > 0 : null,
    expectNoShareWhenWeak: honestyWeak ? !shareCardPresent : null,
  };
}

async function run() {
  const report = {
    image: SRC,
    size: "4284x5712",
    capturedAt: new Date().toISOString(),
    ui: {},
    pipeline: {},
  };

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const consoleErrors = [];
  const telemetryLogs = [];

  async function newPage(viewport) {
    const page = await browser.newPage({ viewport });
    page.on("console", (msg) => {
      const t = msg.text();
      if (msg.type() === "error") consoleErrors.push(t);
      if (/Twinframe Telemetry/i.test(t)) telemetryLogs.push(t);
    });
    page.on("pageerror", (err) => consoleErrors.push(String(err)));
    return page;
  }

  // --- Pipeline dump (same engine the UI uses) ---
  console.log("A. Pipeline internals via Vite import");
  const page = await newPage({ width: 1280, height: 1100 });
  await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);

  const pipelineDump = await page.evaluate(async () => {
    const { analyzeFaceSource, loadImageFromBlob } = await import("/src/lib/face/pipeline.ts");
    const { estimateHeadPose68 } = await import("/src/lib/face/pose.ts");
    const resp = await fetch("/_tmp_img_3936.jpeg");
    if (!resp.ok) throw new Error(`fetch image failed ${resp.status}`);
    const blob = await resp.blob();
    const img = await loadImageFromBlob(blob);

    const t0 = performance.now();
    const first = await analyzeFaceSource(img, { topK: 8 });
    const detectMs = performance.now() - t0;

    const boxes = first.candidateBoxes || [];
    const runs = [];
    for (let i = 0; i < boxes.length; i++) {
      const t = performance.now();
      const r = await analyzeFaceSource(img, { topK: 8, selectedBox: boxes[i] });
      const lms = r.croppedLandmarks;
      r._pose = lms && lms.length >= 68 ? estimateHeadPose68(lms) : null;
      r._elapsedMs = performance.now() - t;
      runs.push(r);
    }
    first._pose =
      first.croppedLandmarks && first.croppedLandmarks.length >= 68
        ? estimateHeadPose68(first.croppedLandmarks)
        : null;
    return { detectMs, first, runs };
  });

  report.pipeline.detectMs = pipelineDump.detectMs;
  report.pipeline.default = serializeResult(pipelineDump.first);
  report.pipeline.faces = pipelineDump.runs.map((r, i) => ({
    faceIndex: i,
    elapsedMs: r._elapsedMs,
    ...serializeResult(r),
  }));
  console.log(
    "Pipeline faces:",
    report.pipeline.faces.map((f) => ({
      i: f.faceIndex,
      age: f.estimatedAge,
      gender: f.estimatedGender,
      occ: f.occlusion,
      top: f.matches[0],
      monotonic: f.percentsMonotonicWithRank,
    })),
  );

  // --- UI: desktop crop + primary + landmarks presence ---
  console.log("B. UI desktop flow");
  await page.locator("input[type='file']").setInputFiles(join(OUT, "IMG_3936.jpeg"));
  await page.waitForSelector("h2:has-text('Choose a face'), button:has-text('Match')", {
    timeout: 60000,
  });
  for (let i = 0; i < 40; i++) {
    const t = await page.locator("body").innerText();
    if (/Face 1|2 faces/i.test(t) && !/Detecting|Scanning faces|Loading face model/i.test(t)) break;
    await sleep(1000);
  }
  await sleep(800);
  await page.screenshot({ path: join(OUT, "02-crop-review.png"), fullPage: true });

  const cropText = await page.locator("body").innerText();
  report.ui.cropReview = {
    found2: /2 faces/i.test(cropText),
    veryLarge: /Very large photo/i.test(cropText),
    excerpt: cropText.slice(0, 900),
  };

  await page.getByRole("button", { name: /Match Face 1|Match|Approve/i }).last().click({ force: true });
  const primaryText = await waitForResults(page, "primary");
  await page.screenshot({ path: join(OUT, "03-primary-results.png"), fullPage: true });
  const landmarksTabCount = await page.getByRole("tab", { name: /Landmarks/i }).count();
  const sideBySideCount = await page.getByRole("tab", { name: /Side-by-Side/i }).count();
  report.ui.primary = {
    ...summarizeResultsUi(primaryText, landmarksTabCount, sideBySideCount),
    excerpt: primaryText.slice(0, 1800),
  };
  console.log(
    "Primary landmarks tab:",
    landmarksTabCount,
    "comparison:",
    sideBySideCount,
    "weak:",
    report.ui.primary.honestyWeak,
    "share:",
    report.ui.primary.shareCardPresent,
    "qualityNote:",
    report.ui.primary.qualityNotePresent,
  );

  // Landmarks HUD is expected for all match bands (including weak). Capture when present.
  if (landmarksTabCount > 0) {
    await page.getByRole("tab", { name: /Landmarks/i }).click();
    await sleep(700);
    await page.screenshot({ path: join(OUT, "04-primary-landmarks.png"), fullPage: true });
  } else {
    report.ui.primary.landmarksNote =
      "Landmarks tab missing — expected present for weak and strong after F3+F5.";
  }

  // Face 2 — stay on the same photo (no re-upload)
  const matchOther = page.getByRole("button", { name: /Match another face/i });
  report.ui.primary.matchOtherFacePresent = (await matchOther.count()) > 0;
  if (await matchOther.count()) {
    await matchOther.click();
    await sleep(800);
  } else {
    await page.getByRole("button", { name: /Try another photo|Try again|Retake/i }).first().click();
    await sleep(800);
    await page.locator("input[type='file']").setInputFiles(join(OUT, "IMG_3936.jpeg"));
  }
  await page.waitForSelector("h2:has-text('Choose a face'), button:has-text('Match')", {
    timeout: 60000,
  });
  for (let i = 0; i < 30; i++) {
    const t = await page.locator("body").innerText();
    if (/Face 2/i.test(t)) break;
    await sleep(1000);
  }
  await sleep(600);
  const face2 = page.locator("button").filter({ hasText: /^Face 2/ }).first();
  if (await face2.count()) await face2.click({ force: true });
  await sleep(400);
  await page.screenshot({ path: join(OUT, "05-second-face-selected.png"), fullPage: true });
  await page.getByRole("button", { name: /Match Face 2|Match/i }).last().click({ force: true });
  const secondText = await waitForResults(page, "second");
  await page.screenshot({ path: join(OUT, "06-second-results.png"), fullPage: true });
  const lm2 = await page.getByRole("tab", { name: /Landmarks/i }).count();
  const side2 = await page.getByRole("tab", { name: /Side-by-Side/i }).count();
  report.ui.second = {
    ...summarizeResultsUi(secondText, lm2, side2),
    ageShown: /~\d+\s*yrs/i.test(secondText),
    excerpt: secondText.slice(0, 1800),
  };
  if (lm2 > 0) {
    await page.getByRole("tab", { name: /Landmarks/i }).click();
    await sleep(700);
    await page.screenshot({ path: join(OUT, "07-second-landmarks.png"), fullPage: true });
  } else {
    report.ui.second.landmarksNote =
      "Landmarks tab missing — expected present for weak and strong after F3+F5.";
  }

  await page.close();

  // --- Mobile crop review ---
  console.log("C. Mobile viewport crop review");
  const mobile = await newPage({ width: 390, height: 844 });
  await mobile.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1200);
  await mobile.screenshot({ path: join(OUT, "08-mobile-home.png"), fullPage: true });
  await mobile.locator("input[type='file']").setInputFiles(join(OUT, "IMG_3936.jpeg"));
  await mobile.waitForSelector("h2:has-text('Choose a face'), button:has-text('Match')", {
    timeout: 60000,
  });
  for (let i = 0; i < 40; i++) {
    const t = await mobile.locator("body").innerText();
    if (/Face 1|2 faces/i.test(t) && !/Detecting|Scanning/i.test(t)) break;
    await sleep(1000);
  }
  await sleep(600);
  await mobile.screenshot({ path: join(OUT, "09-mobile-crop-review.png"), fullPage: true });
  report.ui.mobileCrop = {
    excerpt: (await mobile.locator("body").innerText()).slice(0, 700),
    found2: /2 faces/i.test(await mobile.locator("body").innerText()),
  };
  await mobile.close();

  report.consoleErrors = consoleErrors.slice(0, 40);
  report.telemetryLogs = telemetryLogs.slice(0, 20);
  writeFileSync(join(OUT, "deep-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log("\nSaved deep report to", OUT);
  console.log("Console errors:", consoleErrors.length);
  await browser.close();
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    try {
      unlinkSync(PUBLIC_IMG);
    } catch {
      /* tmp copy */
    }
  });
