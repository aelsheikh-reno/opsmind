// A deliberately failing test, to prove the merge guard refuses a red gate.
// Opened, demonstrated, and closed without merging.
import { describe, expect, it } from "vitest";
describe("merge-guard probe", () => {
  it("fails on purpose so the gates go red", () => {
    expect(1).toBe(2);
  });
});
