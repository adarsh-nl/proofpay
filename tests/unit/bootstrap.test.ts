import { describe, expect, it } from "vitest";

describe("bootstrap", () => {
  it("runs the unit test toolchain", () => {
    expect([1, 2, 3].map((n) => n * 2)).toEqual([2, 4, 6]);
  });
});
