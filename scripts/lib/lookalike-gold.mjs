import fs from "node:fs";

/** @typedef {"identity-regression" | "refuse-smoke" | "civilian"} GoldCaseKind */

/**
 * Identity seeds are closed-set self-retrieval. Synthetic refuses smoke-test the
 * distance floor. Civilian rows are the product metric — and must not be invented.
 *
 * @param {{ id?: string, notes?: string, expectRefuse?: boolean, acceptableTopIds?: string[], fixture?: string, imagePath?: string, kind?: string }} c
 * @returns {GoldCaseKind}
 */
export function classifyGoldCase(c) {
  if (c?.expectRefuse) {
    return "refuse-smoke";
  }
  if (c?.kind === "civilian" || c?.fixture || c?.imagePath || /^civilian/i.test(String(c?.id ?? ""))) {
    return "civilian";
  }
  if (Array.isArray(c?.acceptableTopIds) && c.acceptableTopIds.length === 0) {
    return "refuse-smoke";
  }
  if (/^identity-/i.test(String(c?.id ?? "")) || /self-vector|enrolled self/i.test(String(c?.notes ?? ""))) {
    return "identity-regression";
  }
  return "civilian";
}

export function listCivilianGoldPhotos(fixturesGoldDir) {
  if (!fs.existsSync(fixturesGoldDir)) return [];
  return fs.readdirSync(fixturesGoldDir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f));
}

export function civilianGoldReady(fixturesGoldDir) {
  return listCivilianGoldPhotos(fixturesGoldDir).length > 0;
}

/**
 * @param {{ identityN: number, identityTop1: number, refuseN: number, refuseOk: number, civilianN: number, civilianTop1: number, civilianReady: boolean }} stats
 */
export function formatGoldSummary(stats) {
  const lines = [];
  if (stats.identityN > 0) {
    const pct = ((stats.identityTop1 / stats.identityN) * 100).toFixed(1);
    lines.push(
      `closed-set identity regression @1=${pct}% (${stats.identityTop1}/${stats.identityN})  — not the product metric`,
    );
  }
  if (stats.refuseN > 0) {
    const pct = ((stats.refuseOk / stats.refuseN) * 100).toFixed(1);
    lines.push(`refuse-smoke (synthetic) refuse_ok=${pct}% (${stats.refuseOk}/${stats.refuseN})`);
  }
  if (!stats.civilianReady || stats.civilianN === 0) {
    lines.push("civilian acceptable@1=N/A  (no fixtures/gold photos — do not invent labels)");
  } else {
    const pct = ((stats.civilianTop1 / stats.civilianN) * 100).toFixed(1);
    lines.push(`civilian acceptable@1=${pct}% (${stats.civilianTop1}/${stats.civilianN})`);
  }
  return lines;
}
