import { describe, expect, it } from "vitest";
import { floorToStep, fromCents, toCents } from "@/shared/money";

describe("toCents", () => {
  it.each([
    ["12.34", 1234],
    ["0.10", 10],
    ["99.99", 9999],
    ["0.00", 0],
    ["120.00", 12000],
    ["5", 500],
    ["0.1", 10],
  ])("parses %s to %d cents", (value, cents) => {
    expect(toCents(value)).toBe(cents);
  });

  it("rejects malformed amounts", () => {
    for (const value of ["", "-1.00", "1.234", "1,00", "abc", "1.2.3"]) {
      expect(() => toCents(value)).toThrow();
    }
  });
});

describe("fromCents", () => {
  it.each([
    [1234, "12.34"],
    [10, "0.10"],
    [9999, "99.99"],
    [0, "0.00"],
    [12000, "120.00"],
  ])("formats %d as %s", (cents, value) => {
    expect(fromCents(cents)).toBe(value);
  });

  it("round-trips decimal strings", () => {
    for (const value of ["0.10", "99.99", "0.00", "12.34", "1000000.05"]) {
      expect(fromCents(toCents(value))).toBe(value);
    }
  });

  it("refuses non-integer cents", () => {
    expect(() => fromCents(12.5)).toThrow();
  });
});

describe("floorToStep", () => {
  it("floors to the partial-capture step", () => {
    expect(floorToStep(12000, 0.8, 0.05)).toBe(9600);
    expect(floorToStep(12000, 0.849, 0.05)).toBe(9600);
    expect(floorToStep(12000, 0.85, 0.05)).toBe(10200);
    expect(floorToStep(12000, 1, 0.05)).toBe(12000);
    expect(floorToStep(12000, 0, 0.05)).toBe(0);
  });

  it("is immune to floating-point weight addition noise", () => {
    // Four 0.2 weights summed via thousandths can arrive as 0.8000000000000002.
    const noisyScore = 0.8000000000000002; // what 4 x 0.2 can arrive as after float maths
    expect(noisyScore).not.toBe(0.8);
    expect(floorToStep(12000, noisyScore, 0.05)).toBe(9600);
  });

  it("never rounds up past the authorised amount", () => {
    for (const ratio of [0.01, 0.333, 0.499, 0.899, 0.9999]) {
      expect(floorToStep(9999, ratio, 0.05)).toBeLessThanOrEqual(9999);
    }
    expect(floorToStep(1, 0.5, 0.05)).toBe(0);
    expect(floorToStep(99, 0.5, 0.05)).toBe(49);
  });

  it("validates its inputs", () => {
    expect(() => floorToStep(-1, 0.5, 0.05)).toThrow();
    expect(() => floorToStep(100, 1.5, 0.05)).toThrow();
    expect(() => floorToStep(100, 0.5, 0)).toThrow();
  });
});
