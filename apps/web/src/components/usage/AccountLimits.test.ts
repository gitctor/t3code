import { describe, expect, it } from "vite-plus/test";

import { accountLimitPercentLeft, formatAccountLimitPercentLeft } from "./AccountLimits";

describe("account limit remaining capacity", () => {
  it("subtracts provider-reported usage from the full window", () => {
    expect(accountLimitPercentLeft(0)).toBe(100);
    expect(accountLimitPercentLeft(12.4)).toBeCloseTo(87.6);
    expect(accountLimitPercentLeft(100)).toBe(0);
  });

  it("clamps invalid provider values to an honest display range", () => {
    expect(accountLimitPercentLeft(-10)).toBe(100);
    expect(accountLimitPercentLeft(120)).toBe(0);
    expect(accountLimitPercentLeft(Number.NaN)).toBe(0);
  });

  it("labels the rounded value as percent left", () => {
    expect(formatAccountLimitPercentLeft(12.4)).toBe("88% left");
  });
});
