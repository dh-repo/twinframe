import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectCanonicalMesh } from "../../components/results/biometric-mesh.tsx";
import { CANONICAL_FACE_3D } from "./pose.ts";

describe("Biometric mesh projection", () => {
  it("projects 68 canonical nodes into 0–100 view space", () => {
    const pts = projectCanonicalMesh();
    assert.equal(pts.length, CANONICAL_FACE_3D.length);
    assert.equal(pts.length, 68);
    for (const p of pts) {
      assert.ok(p.x >= 0 && p.x <= 100);
      assert.ok(p.y >= 0 && p.y <= 100);
    }
  });
});
