// ---------------------------------------------------------------------------
// Fixed Asset Depreciation Engine — Unit Tests
// Tests for calculateMonthlyDepreciation, generateSchedule, adviseOnCapitalisation
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { calculateMonthlyDepreciation, generateSchedule, adviseOnCapitalisation } from "./engine.js";

// ---------------------------------------------------------------------------
// 1. Jurisdiction config — FY labels via generateSchedule
// ---------------------------------------------------------------------------

describe("Jurisdiction config — FY labels", () => {
  // purchaseDate "2025-12-15" means first period is Jan 2026
  // We use straight_line with 12 months so we get predictable periods.

  it("AU FY label for Jan 2026 is '2025-26' (July start, before July = previous FY)", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-12-15", "straight_line", "AU");
    expect(schedule.length).toBeGreaterThan(0);
    // First period date is Jan 2026
    expect(schedule[0]!.periodDate).toBe("2026-01-15");
    expect(schedule[0]!.financialYear).toBe("2025-26");
  });

  it("US FY label for Jan 2026 is '2026' (Jan start)", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-12-15", "straight_line", "US");
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0]!.periodDate).toBe("2026-01-15");
    expect(schedule[0]!.financialYear).toBe("2026");
  });

  it("UK FY label for Jan 2026 is '2025-26' (April start, before April = previous FY)", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-12-15", "straight_line", "UK");
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0]!.periodDate).toBe("2026-01-15");
    expect(schedule[0]!.financialYear).toBe("2025-26");
  });
});

// ---------------------------------------------------------------------------
// 2. Capitalisation advisory
// ---------------------------------------------------------------------------

describe("Capitalisation advisory", () => {
  it("AU $200 (20000 cents) laptop → expense (below 30000 threshold)", () => {
    const result = adviseOnCapitalisation(20000, "AU", null, 2025, "laptop");
    expect(result.recommendation).toBe("expense");
  });

  it("AU $3,000 (300000 cents) laptop, SBE turnover 50000000 → instant_writeoff", () => {
    const result = adviseOnCapitalisation(300000, "AU", 50000000, 2025, "laptop");
    expect(result.recommendation).toBe("instant_writeoff");
    expect(result.threshold).toBe(2_000_000);
  });

  it("AU $3,000 laptop, turnover > 1B (150000000000) → capitalise (over SBE threshold)", () => {
    const result = adviseOnCapitalisation(300000, "AU", 150000000000, 2025, "laptop");
    expect(result.recommendation).toBe("capitalise");
  });

  it("US $5,000 (500000 cents) computer → consider_section_179", () => {
    const result = adviseOnCapitalisation(500000, "US", null, 2025, "desktop_computer");
    expect(result.recommendation).toBe("consider_section_179");
  });

  it("UK £500 (50000 cents) laptop → capitalise (UK threshold is 0, everything capitalised)", () => {
    const result = adviseOnCapitalisation(50000, "UK", null, 2025, "laptop");
    expect(result.recommendation).toBe("capitalise");
  });
});

// ---------------------------------------------------------------------------
// 3. AU Diminishing Value
// ---------------------------------------------------------------------------

describe("AU Diminishing Value", () => {
  // $3,000 (300000 cents), 3yr life (36 months), salvage 0
  // rate = 2.0 / 3 / 12 = 0.055555...

  it("Month 1 amount = floor(300000 * (2.0/3/12)) = 16666", () => {
    const amount = calculateMonthlyDepreciation(
      "diminishing_value", 300000, 0, 36, 300000, 1, "AU",
    );
    expect(amount).toBe(16666);
  });

  it("Month 2: NBV = 300000-16666 = 283334, amount = floor(283334 * 0.05556) = 15739", () => {
    const amount = calculateMonthlyDepreciation(
      "diminishing_value", 300000, 0, 36, 283334, 2, "AU",
    );
    // 283334 * (2.0/3/12) = 283334 * 0.0555555... = 15740.7777...
    // Actually let's compute precisely: 283334 * 2 / 3 / 12 = 283334 / 18 = 15740.777...
    // floor(15740.777) = 15740
    // But the user spec says 15739. Let's check: 283334 * 0.05556 = 15740.03...
    // The actual code: rate = 2.0 / 3 / 12 in JS = 0.05555555555555555
    // 283334 * 0.05555555555555555 = 15740.777... → floor = 15740
    // The spec number 15739 may be approximate. Let's use the correct value.
    expect(amount).toBe(15740);
  });

  it("Full schedule over useful life — all amounts positive, NBV decreases monotonically", () => {
    const schedule = generateSchedule(300000, 0, 36, "2025-01-01", "diminishing_value", "AU");
    expect(schedule).toHaveLength(36);
    for (const period of schedule) {
      expect(period.depreciationAmount).toBeGreaterThan(0);
    }
    // DV method asymptotically approaches 0; after 36 periods NBV > 0
    // Each period's NBV should be less than the previous
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.netBookValue).toBeLessThan(schedule[i - 1]!.netBookValue);
    }
    // Final NBV should be significantly reduced from original cost
    expect(schedule[schedule.length - 1]!.netBookValue).toBeLessThan(300000 * 0.15);
  });
});

// ---------------------------------------------------------------------------
// 4. AU Prime Cost (straight_line equivalent)
// ---------------------------------------------------------------------------

describe("AU Prime Cost", () => {
  it("$3,000, 3yr life: monthly = floor(300000/36) = 8333", () => {
    const amount = calculateMonthlyDepreciation(
      "prime_cost", 300000, 0, 36, 300000, 1, "AU",
    );
    expect(amount).toBe(8333);
  });

  it("With $500 (50000) salvage: monthly = floor((300000-50000)/36) = 6944", () => {
    const amount = calculateMonthlyDepreciation(
      "prime_cost", 300000, 50000, 36, 300000, 1, "AU",
    );
    expect(amount).toBe(6944);
  });
});

// ---------------------------------------------------------------------------
// 5. US MACRS
// ---------------------------------------------------------------------------

describe("US MACRS", () => {
  // $10,000 (1000000 cents) 5-year property

  it("5-year Year 1 monthly = floor(floor(1000000*0.20)/12) = floor(200000/12) = 16666", () => {
    // periodNumber 1 → year = ceil(1/12) = 1 → table[0] = 20.0%
    const amount = calculateMonthlyDepreciation(
      "macrs", 1000000, 0, 60, 1000000, 1, "US", "5-year",
    );
    expect(amount).toBe(16666);
  });

  it("5-year Year 2 monthly = floor(floor(1000000*0.32)/12) = floor(320000/12) = 26666", () => {
    // periodNumber 13 → year = ceil(13/12) = 2 → table[1] = 32.0%
    const amount = calculateMonthlyDepreciation(
      "macrs", 1000000, 0, 60, 680000, 13, "US", "5-year",
    );
    expect(amount).toBe(26666);
  });

  it("7-year Year 1 monthly = floor(floor(1000000*0.1429)/12) = floor(142900/12) = 11908", () => {
    const amount = calculateMonthlyDepreciation(
      "macrs", 1000000, 0, 84, 1000000, 1, "US", "7-year",
    );
    expect(amount).toBe(11908);
  });
});

// ---------------------------------------------------------------------------
// 6. UK Writing Down Allowance
// ---------------------------------------------------------------------------

describe("UK Writing Down Allowance", () => {
  it("Main pool: $10,000 (1000000), rate 18%: Month 1 = floor(1000000 * 0.18 / 12) = 15000", () => {
    const amount = calculateMonthlyDepreciation(
      "writing_down_allowance", 1000000, 0, 60, 1000000, 1, "UK", null, "main",
    );
    expect(amount).toBe(15000);
  });

  it("Special pool: rate 6%: Month 1 = floor(1000000 * 0.06 / 12) = 5000", () => {
    const amount = calculateMonthlyDepreciation(
      "writing_down_allowance", 1000000, 0, 60, 1000000, 1, "UK", null, "special",
    );
    expect(amount).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// 7. Instant write-off methods
// ---------------------------------------------------------------------------

describe("Instant write-off methods", () => {
  it("instant_writeoff: period 1 gets full cost minus salvage", () => {
    const amount = calculateMonthlyDepreciation(
      "instant_writeoff", 500000, 50000, 1, 500000, 1, "AU",
    );
    expect(amount).toBe(450000);
  });

  it("section_179: period 1 gets full cost minus salvage", () => {
    const amount = calculateMonthlyDepreciation(
      "section_179", 500000, 50000, 1, 500000, 1, "US",
    );
    expect(amount).toBe(450000);
  });

  it("aia: period 1 gets full cost minus salvage", () => {
    const amount = calculateMonthlyDepreciation(
      "aia", 500000, 50000, 1, 500000, 1, "UK",
    );
    expect(amount).toBe(450000);
  });
});

// ---------------------------------------------------------------------------
// 8. Schedule generation
// ---------------------------------------------------------------------------

describe("Schedule generation", () => {
  it("'none' method → empty array", () => {
    const schedule = generateSchedule(100000, 0, 36, "2025-01-01", "none", "AU");
    expect(schedule).toEqual([]);
  });

  it("Straight line 12 months → 12 periods", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-01-01", "straight_line", "AU");
    expect(schedule).toHaveLength(12);
  });

  it("instant_writeoff → exactly 1 period", () => {
    const schedule = generateSchedule(500000, 0, 1, "2025-01-01", "instant_writeoff", "AU");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(500000);
    expect(schedule[0]!.netBookValue).toBe(0);
  });

  it("First period date is purchaseDate + 1 month", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-03-15", "straight_line", "AU");
    expect(schedule[0]!.periodDate).toBe("2025-04-15");
  });

  it("Last period NBV = salvageValue (test with salvage > 0)", () => {
    const schedule = generateSchedule(120000, 20000, 12, "2025-01-01", "straight_line", "AU");
    // monthly = floor((120000 - 20000) / 12) = floor(8333.33) = 8333
    // 12 * 8333 = 99996, depreciable = 100000, residual = 4
    // 4 < 100000 * 0.01 = 1000, so rounding adjustment absorbs it
    const last = schedule[schedule.length - 1]!;
    expect(last.netBookValue).toBe(20000);
  });

  it("Accumulated depreciation on last period = costAmount - salvageValue", () => {
    const schedule = generateSchedule(120000, 20000, 12, "2025-01-01", "straight_line", "AU");
    const last = schedule[schedule.length - 1]!;
    expect(last.accumulatedDepreciation).toBe(100000); // 120000 - 20000
  });
});

// ---------------------------------------------------------------------------
// 9. Rounding adjustment
// ---------------------------------------------------------------------------

describe("Rounding adjustment", () => {
  it("Straight line rounding residual is absorbed into last period (Jan 1 — threshold rounds to full)", () => {
    // 100000 cost, 0 salvage, 3 months → monthly = floor(100000/3) = 33333
    // Pro-rata Jan 1: factor = 30/31 ≈ 0.968 → >= 0.95 threshold → rounds to 1.0
    // So period 1 = 33333 (full), period 2 = 33333, period 3 absorbs residual = 33334
    const schedule = generateSchedule(100000, 0, 3, "2025-01-01", "straight_line", "AU");
    expect(schedule).toHaveLength(3);
    const last = schedule[schedule.length - 1]!;
    expect(last.netBookValue).toBe(0);
    expect(last.accumulatedDepreciation).toBe(100000);
    // First period is full (threshold kicked in)
    expect(schedule[0]!.depreciationAmount).toBe(33333);
    // Last period absorbs remainder
    expect(last.depreciationAmount).toBe(33334);
  });

  it("Without pro-rata, simple rounding is absorbed (proRataFirstPeriod=false)", () => {
    // Same scenario but without pro-rata
    const schedule = generateSchedule(100000, 0, 3, "2025-01-01", "straight_line", "AU",
      null, null, false);
    expect(schedule).toHaveLength(3);
    const last = schedule[schedule.length - 1]!;
    expect(last.netBookValue).toBe(0);
    expect(last.accumulatedDepreciation).toBe(100000);
    // Without pro-rata: period 1 = 33333, period 2 = 33333, period 3 = 33334
    expect(schedule[0]!.depreciationAmount).toBe(33333);
    expect(last.depreciationAmount).toBe(33334);
  });

  it("Verifies last period absorbs small difference so NBV = salvage exactly", () => {
    // 250000 cost, 10000 salvage, 7 months
    // monthly = floor((250000 - 10000) / 7) = floor(34285.71) = 34285
    // With pro-rata and linear method, last period absorbs all residual
    const schedule = generateSchedule(250000, 10000, 7, "2025-01-01", "straight_line", "AU");
    expect(schedule).toHaveLength(7);
    const last = schedule[schedule.length - 1]!;
    expect(last.netBookValue).toBe(10000);
    expect(last.accumulatedDepreciation).toBe(240000);
  });
});

// ---------------------------------------------------------------------------
// 10. Additional methods
// ---------------------------------------------------------------------------

describe("Additional methods", () => {
  it("declining_balance NZ: rate uses 1.5 instead of 2.0", () => {
    // 300000 cost, 36 months life, NBV 300000
    // rate = 1.5 / 3 / 12 = 0.041666...
    // amount = floor(300000 * 0.041666...) = floor(12500) = 12500
    const amount = calculateMonthlyDepreciation(
      "declining_balance", 300000, 0, 36, 300000, 1, "NZ",
    );
    expect(amount).toBe(12500);
  });

  it("declining_balance non-NZ: rate uses 2.0", () => {
    // 300000 cost, 36 months life, NBV 300000
    // rate = 2.0 / 3 / 12 = 0.055555...
    // amount = floor(300000 * 0.055555) = 16666
    const amount = calculateMonthlyDepreciation(
      "declining_balance", 300000, 0, 36, 300000, 1, "US",
    );
    expect(amount).toBe(16666);
  });

  it("cca: floor(NBV * 0.30 / 12)", () => {
    // NBV = 500000, amount = floor(500000 * 0.30 / 12) = floor(12500) = 12500
    const amount = calculateMonthlyDepreciation(
      "cca", 500000, 0, 60, 500000, 1, "CA",
    );
    expect(amount).toBe(12500);
  });

  it("none: returns 0", () => {
    const amount = calculateMonthlyDepreciation(
      "none", 300000, 0, 36, 300000, 1, "AU",
    );
    expect(amount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Edge cases
// ---------------------------------------------------------------------------

describe("Edge cases", () => {
  it("Zero salvage value works correctly", () => {
    const schedule = generateSchedule(60000, 0, 6, "2025-01-01", "straight_line", "AU");
    // monthly = floor(60000 / 6) = 10000 — exact division, no rounding
    expect(schedule).toHaveLength(6);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(0);
    expect(schedule[schedule.length - 1]!.accumulatedDepreciation).toBe(60000);
  });

  it("Very short life (1 month) works", () => {
    const schedule = generateSchedule(100000, 0, 1, "2025-06-01", "straight_line", "AU");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(100000);
    expect(schedule[0]!.netBookValue).toBe(0);
    expect(schedule[0]!.periodDate).toBe("2025-07-01");
  });

  it("Very long life (360 months / 30 years) generates correct number of periods for straight line", () => {
    const schedule = generateSchedule(3600000, 0, 360, "2025-01-01", "straight_line", "AU");
    // monthly = floor(3600000 / 360) = 10000 — exact division
    expect(schedule).toHaveLength(360);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases for completeness
// ---------------------------------------------------------------------------

describe("Instant write-off schedule methods", () => {
  it("section_179 schedule has exactly 1 period", () => {
    const schedule = generateSchedule(1000000, 0, 1, "2025-01-01", "section_179", "US");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(1000000);
    expect(schedule[0]!.netBookValue).toBe(0);
  });

  it("aia schedule has exactly 1 period", () => {
    const schedule = generateSchedule(1000000, 0, 1, "2025-01-01", "aia", "UK");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(1000000);
    expect(schedule[0]!.netBookValue).toBe(0);
  });

  it("instant_writeoff period 2 returns 0", () => {
    const amount = calculateMonthlyDepreciation(
      "instant_writeoff", 500000, 0, 1, 0, 2, "AU",
    );
    expect(amount).toBe(0);
  });
});

describe("MACRS defaults to 5-year when no property class specified", () => {
  it("Uses 5-year table by default", () => {
    // No macrsPropertyClass → defaults to "5-year"
    // Year 1: 20% → floor(floor(1000000 * 0.20) / 12) = floor(200000/12) = 16666
    const amount = calculateMonthlyDepreciation(
      "macrs", 1000000, 0, 60, 1000000, 1, "US", null,
    );
    expect(amount).toBe(16666);
  });
});

describe("WDA defaults to main pool when no pool specified", () => {
  it("Uses main pool (18%) by default", () => {
    const amount = calculateMonthlyDepreciation(
      "writing_down_allowance", 1000000, 0, 60, 1000000, 1, "UK", null, null,
    );
    expect(amount).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// 12. MACRS Half-Year Convention
// ---------------------------------------------------------------------------

describe("MACRS half-year convention", () => {
  // $10,000 (1000000 cents), 5-year property, purchased July 1
  // Year 1 = 6 months (Jul–Dec), Year 2–5 = 12 months each, Year 6 = 6 months
  // Total periods = 6 + 48 + 6 = 60

  it("5-year July purchase: year 1 has 6 months of depreciation", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-07-01", "macrs", "US", "5-year");
    // Year 1 (20%): annual = floor(1000000 * 0.20) = 200000
    // Spread over 6 months: monthly = floor(200000/6) = 33333
    // Last month of year: 200000 - 5*33333 = 200000 - 166665 = 33335
    // First 5 periods should be 33333, 6th should be 33335
    expect(schedule[0]!.depreciationAmount).toBe(33333);
    expect(schedule[4]!.depreciationAmount).toBe(33333);
    expect(schedule[5]!.depreciationAmount).toBe(33335); // rounding remainder

    // Verify year 1 total = 200000
    let year1Total = 0;
    for (let i = 0; i < 6; i++) year1Total += schedule[i]!.depreciationAmount;
    expect(year1Total).toBe(200000);
  });

  it("5-year July purchase: year 2 has 12 months", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-07-01", "macrs", "US", "5-year");
    // Year 2 (32%): annual = floor(1000000 * 0.32) = 320000
    // Spread over 12 months: monthly = floor(320000/12) = 26666
    // Last month of year 2: 320000 - 11*26666 = 320000 - 293326 = 26674
    expect(schedule[6]!.depreciationAmount).toBe(26666); // first month of year 2
    expect(schedule[16]!.depreciationAmount).toBe(26666); // 11th month of year 2
    expect(schedule[17]!.depreciationAmount).toBe(26674); // last month of year 2

    let year2Total = 0;
    for (let i = 6; i < 18; i++) year2Total += schedule[i]!.depreciationAmount;
    expect(year2Total).toBe(320000);
  });

  it("5-year July purchase: total periods = 60", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-07-01", "macrs", "US", "5-year");
    // 6 + 12 + 12 + 12 + 12 + 6 = 60
    expect(schedule).toHaveLength(60);
  });

  it("5-year July purchase: total depreciation = cost", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-07-01", "macrs", "US", "5-year");
    const totalDep = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(totalDep).toBe(1000000);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(0);
  });

  it("5-year January purchase: year 1 has 12 months, final year has 6", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-01-01", "macrs", "US", "5-year");
    // Year 1: 12 months (12 - 0 = 12), Years 2-5: 12 each, Year 6 (final): always 6
    // Total = 12 + 48 + 6 = 66
    expect(schedule).toHaveLength(66);
    // Year 1 annual = 200000, monthly = floor(200000/12) = 16666
    expect(schedule[0]!.depreciationAmount).toBe(16666);
    let year1Total = 0;
    for (let i = 0; i < 12; i++) year1Total += schedule[i]!.depreciationAmount;
    expect(year1Total).toBe(200000);
  });

  it("5-year January purchase: total depreciation = cost", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-01-01", "macrs", "US", "5-year");
    const totalDep = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(totalDep).toBe(1000000);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(0);
  });

  it("7-year property: uses correct table and total = cost", () => {
    const schedule = generateSchedule(1000000, 0, 84, "2025-07-01", "macrs", "US", "7-year");
    // 7-year table has 8 entries: Year 1 (6mo) + Years 2–7 (12mo each) + Year 8 (6mo)
    // Total = 6 + 72 + 6 = 84
    expect(schedule).toHaveLength(84);
    const totalDep = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(totalDep).toBe(1000000);
  });

  it("3-year property: schedule has correct length", () => {
    const schedule = generateSchedule(1000000, 0, 36, "2025-07-01", "macrs", "US", "3-year");
    // 3-year table has 4 entries: 6 + 12 + 12 + 6 = 36
    expect(schedule).toHaveLength(36);
    const totalDep = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(totalDep).toBe(1000000);
  });

  it("MACRS with salvage value: total = cost - salvage", () => {
    const schedule = generateSchedule(1000000, 50000, 60, "2025-07-01", "macrs", "US", "5-year");
    const totalDep = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(totalDep).toBe(950000);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(50000);
  });

  it("MACRS final year absorbs remaining amount", () => {
    const schedule = generateSchedule(1000000, 0, 60, "2025-07-01", "macrs", "US", "5-year");
    // Year 6 (final) should have 6 months
    // Its total = whatever remains after years 1-5
    const years1to5 = schedule.slice(0, 54).reduce((sum, p) => sum + p.depreciationAmount, 0);
    const year6 = schedule.slice(54).reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(year6).toBe(1000000 - years1to5);
    expect(schedule.slice(54)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// 13. Pro-rata first period
// ---------------------------------------------------------------------------

describe("Pro-rata first period", () => {
  it("March 15 purchase: period 1 = floor(monthly × 16/31)", () => {
    // 120000 cost, 0 salvage, 12 months, purchase March 15
    // monthly = floor(120000/12) = 10000
    // March: 31 days, daysRemaining = 31 - 15 = 16
    // proRataFactor = 16/31
    // period 1 = floor(10000 * 16/31) = floor(5161.29) = 5161
    const schedule = generateSchedule(120000, 0, 12, "2025-03-15", "straight_line", "AU");
    expect(schedule[0]!.depreciationAmount).toBe(5161);
  });

  it("period dates are unchanged (still purchaseDate + 1 month)", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-03-15", "straight_line", "AU");
    expect(schedule[0]!.periodDate).toBe("2025-04-15");
    expect(schedule[1]!.periodDate).toBe("2025-05-15");
  });

  it("proRataFirstPeriod=false gives full first month", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-03-15", "straight_line", "AU",
      null, null, false);
    expect(schedule[0]!.depreciationAmount).toBe(10000); // full monthly
  });

  it("total depreciation equals cost - salvage exactly (straight_line)", () => {
    const schedule = generateSchedule(120000, 0, 12, "2025-03-15", "straight_line", "AU");
    const total = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(total).toBe(120000);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(0);
  });

  it("total depreciation equals cost - salvage for prime_cost with salvage", () => {
    const schedule = generateSchedule(300000, 50000, 36, "2025-03-15", "prime_cost", "AU");
    const total = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(total).toBe(250000);
    expect(schedule[schedule.length - 1]!.netBookValue).toBe(50000);
  });

  it("pro-rata does not apply to instant_writeoff", () => {
    const schedule = generateSchedule(500000, 0, 1, "2025-03-15", "instant_writeoff", "AU");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(500000); // full amount, no pro-rata
  });

  it("pro-rata does not apply to section_179", () => {
    const schedule = generateSchedule(500000, 0, 1, "2025-03-15", "section_179", "US");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(500000);
  });

  it("pro-rata does not apply to 1-month useful life", () => {
    // maxPeriods = 1, so pro-rata is skipped (maxPeriods > 1 check)
    const schedule = generateSchedule(100000, 0, 1, "2025-03-15", "straight_line", "AU");
    expect(schedule).toHaveLength(1);
    expect(schedule[0]!.depreciationAmount).toBe(100000);
  });

  it("AU diminishing value with Jan 1 purchase: factor rounds to 1.0, amounts decrease monotonically", () => {
    // Purchase Jan 1: factor = 30/31 ≈ 0.968 → >= 0.95 threshold → rounds to 1.0
    const schedule = generateSchedule(300000, 0, 36, "2025-01-01", "diminishing_value", "AU");
    expect(schedule).toHaveLength(36);
    // NBV should decrease monotonically
    for (let i = 1; i < schedule.length; i++) {
      expect(schedule[i]!.netBookValue).toBeLessThan(schedule[i - 1]!.netBookValue);
    }
  });

  it("mid-month purchase date: factor computed correctly for 28-day month", () => {
    // February 15, 2025: 28 days in Feb 2025
    // daysRemaining = 28 - 15 = 13, factor = 13/28
    // monthly = floor(120000/12) = 10000
    // period 1 = floor(10000 * 13/28) = floor(4642.86) = 4642
    const schedule = generateSchedule(120000, 0, 12, "2025-02-15", "straight_line", "AU");
    expect(schedule[0]!.depreciationAmount).toBe(4642);
    // Total still = 120000
    const total = schedule.reduce((sum, p) => sum + p.depreciationAmount, 0);
    expect(total).toBe(120000);
  });

  it("last-day-of-month purchase: factor = 0 → period 1 gets 0 → schedule still works", () => {
    // Jan 31: daysRemaining = 31 - 31 = 0, factor = 0/31 = 0
    // Period 1 amount = floor(10000 * 0) = 0 → breaks out of loop? No:
    // proRataFactor = 0.0, daysRemaining = 0, which is NOT > 0 so proRataFactor stays 1.0
    // The condition `daysRemaining > 0 && daysRemaining < totalDays` prevents factor = 0
    const schedule = generateSchedule(120000, 0, 12, "2025-01-31", "straight_line", "AU");
    expect(schedule).toHaveLength(12);
    expect(schedule[0]!.depreciationAmount).toBe(10000); // full amount (no pro-rata)
  });
});
