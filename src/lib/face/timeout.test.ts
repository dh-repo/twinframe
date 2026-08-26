import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StageTimeoutError, withTimeout } from "./timeout.ts";

describe("withTimeout", () => {
  it("resolves with the underlying value when it settles before the deadline", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 50, "quick stage");
    assert.equal(result, "ok");
  });

  it("rejects with the underlying error when it rejects before the deadline", async () => {
    await assert.rejects(
      withTimeout(Promise.reject(new Error("boom")), 50, "quick stage"),
      /boom/,
    );
  });

  it("rejects with a StageTimeoutError naming the stage when the deadline elapses first", async () => {
    const never = new Promise<never>(() => {});
    await assert.rejects(withTimeout(never, 10, "slow stage"), (err: unknown) => {
      assert.ok(err instanceof StageTimeoutError);
      assert.match((err as Error).message, /slow stage timed out after 10ms/);
      return true;
    });
  });
});
