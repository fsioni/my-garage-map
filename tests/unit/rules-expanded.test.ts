import path from "node:path";
import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  createId,
  type Expense,
  ExpenseIdSchema,
  type MaintenanceEvent,
  MaintenanceEventIdSchema,
  type Reminder,
  ReminderIdSchema,
  VehicleIdSchema,
} from "../../src/domain/models.js";
import {
  acceptsMileage,
  aggregateCosts,
  costPerKm,
  formatMoney,
  isIsoDate,
  isNonNegativeInteger,
  maintenanceTotal,
  nextReminderOccurrence,
  nonEmpty,
  normalizeVin,
  parseMoney,
  partTotal,
  reminderStatus,
  sumPartTotals,
  validateDocumentPath,
} from "../../src/domain/rules.js";

const vehicleId = createId(VehicleIdSchema);
const now = "2026-06-15T12:00:00.000Z";

const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: createId(ReminderIdSchema),
  vehicleId,
  title: "Service",
  category: "other",
  dueDate: "2026-07-15",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("money parsing edge cases", () => {
  it.each([
    ["0", 0],
    ["0.0", 0],
    ["0.00", 0],
    ["1", 100],
    ["1.0", 100],
    ["1.00", 100],
    ["1.01", 101],
    ["1.1", 110],
    ["9.99", 999],
    ["10.09", 1_009],
    ["999", 99_900],
    ["999999.99", 99_999_999],
    ["90071992547409.9", 9_007_199_254_740_990],
  ])("accepts %s as exact integer cents", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    ".",
    ".50",
    "1.",
    "01",
    "00.10",
    "+1",
    "-0",
    "-1",
    "1.001",
    "1.999",
    "1,00",
    "1 000",
    "1_000",
    "NaN",
    "Infinity",
    "1e2",
    "0x10",
    "90071992547410",
  ])("rejects malformed or unsafe amount %s", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it.each([
    [0, "0.00"],
    [1, "0.01"],
    [9, "0.09"],
    [10, "0.10"],
    [99, "0.99"],
    [100, "1.00"],
    [101, "1.01"],
    [110, "1.10"],
    [9_999, "99.99"],
    [1_000_000, "10000.00"],
  ])("formats %i cents as %s", (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });
});

describe("primitive domain validation", () => {
  it.each([
    ["VIN123", "VIN123"],
    [" vin123 ", "VIN123"],
    ["vf3abc-def", "VF3ABC-DEF"],
    ["\tvf3\n", "VF3"],
    ["", undefined],
    ["   ", undefined],
    [undefined, undefined],
  ])("normalizes VIN %#", (input, expected) => {
    expect(normalizeVin(input)).toBe(expected);
  });

  it.each([
    ["x", true],
    [" x ", true],
    ["0", true],
    ["", false],
    [" ", false],
    ["\n\t", false],
  ])("checks non-empty string %#", (input, expected) => {
    expect(nonEmpty(input)).toBe(expected);
  });

  it.each([
    [0, true],
    [1, true],
    [Number.MAX_SAFE_INTEGER, true],
    [-1, false],
    [0.1, false],
    [Number.MAX_SAFE_INTEGER + 1, false],
    [Number.POSITIVE_INFINITY, false],
    [Number.NaN, false],
  ])("checks non-negative safe integer %#", (input, expected) => {
    expect(isNonNegativeInteger(input)).toBe(expected);
  });

  it.each([
    ["2026-01-01", true],
    ["2024-02-29", true],
    ["2026-01-01T00:00:00Z", true],
    ["2026-01-01T23:59:59.999Z", true],
    ["2026-1-1", false],
    ["01/01/2026", false],
    ["2026-01-01T00:00:00+01:00", false],
    ["2026-02-30T00:00:00Z", false],
    ["2026-01-01T24:00:00Z", false],
    ["2026-01-01T23:60:00Z", false],
    ["2026-02-29", false],
    ["2026-02-30", false],
    ["2026-04-31", false],
    ["2026-00-01", false],
    ["2026-13-01", false],
    ["not-a-date", false],
    ["", false],
  ])("validates supported ISO representation %#", (input, expected) => {
    expect(isIsoDate(input)).toBe(expected);
  });
});

describe("mileage and cost arithmetic", () => {
  it.each([
    [0, 0, true],
    [0, 1, true],
    [100, 100, true],
    [100, 101, true],
    [100, 99, false],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, true],
    [0, -1, false],
    [0, 1.5, false],
  ])("evaluates mileage transition %#", (current, candidate, expected) => {
    expect(acceptsMileage(current, candidate)).toBe(expected);
  });

  it.each([
    [1, 0, 0],
    [1, 100, 100],
    [2, 100, 200],
    [3, 333, 999],
    [10_000, 10_000, 100_000_000],
  ])("calculates part total %#", (quantity, unitPriceCents, expected) => {
    expect(partTotal(quantity, unitPriceCents)).toBe(expected);
  });

  it.each([
    [0, 0, 0],
    [100, 0, 100],
    [0, 100, 100],
    [100, 200, 300],
    [9_999, 1, 10_000],
  ])("calculates maintenance total %#", (labor, parts, expected) => {
    expect(maintenanceTotal(labor, parts)).toBe(expected);
  });

  it.each([
    [[], 0],
    [[{ totalPriceCents: 0 }], 0],
    [[{ totalPriceCents: 100 }], 100],
    [[{ totalPriceCents: 100 }, { totalPriceCents: 200 }], 300],
  ])("sums part totals %#", (parts, expected) => {
    expect(sumPartTotals(parts)).toBe(expected);
  });

  it.each([
    [0, 1_000, 0, 0],
    [10_000, 2_000, 1_000, 10],
    [10_000, 1_001, 1_000, 10_000],
    [10_000, 1_000, 1_000, null],
    [10_000, 999, 1_000, null],
  ])("calculates cost per km %#", (cost, current, initial, expected) => {
    expect(costPerKm(cost, current, initial)).toBe(expected);
  });
});

describe("reminder status boundaries", () => {
  it("marks a completed reminder before considering due thresholds", () => {
    expect(
      reminderStatus(reminder({ completedAt: now, dueDate: "2020-01-01" }), 999_999, now),
    ).toBe("completed");
  });

  it.each([
    ["2026-06-14", "overdue"],
    ["2026-06-15", "due"],
    ["2026-07-15", "due"],
    ["2026-07-16", "upcoming"],
    ["2026-08-01", "upcoming"],
  ])("computes date status for due date %s", (dueDate, expected) => {
    expect(reminderStatus(reminder({ dueDate }), 0, now)).toBe(expected);
  });

  it.each([
    [9_999, "overdue"],
    [10_000, "due"],
    [10_999, "due"],
    [11_000, "due"],
    [11_001, "upcoming"],
  ])("computes mileage status at current 10,000 for due mileage %i", (dueMileageKm, expected) => {
    expect(reminderStatus(reminder({ dueDate: undefined, dueMileageKm }), 10_000, now)).toBe(
      expected,
    );
  });

  it("uses the most urgent of date and mileage thresholds", () => {
    expect(
      reminderStatus(reminder({ dueDate: "2027-01-01", dueMileageKm: 9_000 }), 10_000, now),
    ).toBe("overdue");
  });

  it("keeps a reminder upcoming when both thresholds are distant", () => {
    expect(
      reminderStatus(reminder({ dueDate: "2027-01-01", dueMileageKm: 20_000 }), 10_000, now),
    ).toBe("upcoming");
  });
});

describe("reminder recurrence calculation", () => {
  it.each([
    ["2024-01-31", 1, "2024-02-29"],
    ["2023-01-31", 1, "2023-02-28"],
    ["2024-02-29", 12, "2025-02-28"],
    ["2026-12-31", 1, "2027-01-31"],
    ["2026-06-15", 6, "2026-12-15"],
    ["2026-06-15", 18, "2027-12-15"],
  ])("advances %s by %i calendar months to %s", (dueDate, months, expected) => {
    expect(
      nextReminderOccurrence(
        reminder({ dueDate, recurrenceMonths: months, dueMileageKm: undefined }),
      ),
    ).toMatchObject({ dueDate: expected });
  });

  it.each([
    [0, 1, 1],
    [1_000, 10_000, 11_000],
    [100_000, 15_000, 115_000],
  ])("advances mileage %i by %i to %i", (dueMileageKm, recurrenceKm, expected) => {
    expect(
      nextReminderOccurrence(
        reminder({
          dueDate: undefined,
          dueMileageKm,
          recurrenceKm,
        }),
      ),
    ).toMatchObject({ dueMileageKm: expected });
  });

  it("preserves title, category, vehicle, recurrence and notes", () => {
    expect(
      nextReminderOccurrence(
        reminder({
          title: "Oil",
          category: "engine_oil",
          dueDate: "2026-06-30",
          dueMileageKm: 20_000,
          recurrenceMonths: 12,
          recurrenceKm: 10_000,
          notes: "Use 5W30",
        }),
      ),
    ).toMatchObject({
      vehicleId,
      title: "Oil",
      category: "engine_oil",
      dueDate: "2027-06-30",
      dueMileageKm: 30_000,
      recurrenceMonths: 12,
      recurrenceKm: 10_000,
      notes: "Use 5W30",
    });
  });

  it("returns null without recurrence", () => {
    expect(nextReminderOccurrence(reminder())).toBeNull();
  });
});

describe("cost aggregation", () => {
  const maintenance = (
    category: MaintenanceEvent["category"],
    totalCostCents: number,
  ): MaintenanceEvent => ({
    id: createId(MaintenanceEventIdSchema),
    vehicleId,
    title: "Maintenance",
    category,
    performedAt: "2026-01-01",
    mileageKm: 1_000,
    laborCostCents: totalCostCents,
    partsCostCents: 0,
    totalCostCents,
    parts: [],
    createdAt: now,
    updatedAt: now,
  });
  const expense = (category: Expense["category"], amountCents: number): Expense => ({
    id: createId(ExpenseIdSchema),
    vehicleId,
    category,
    description: "Expense",
    amountCents,
    incurredAt: "2026-01-01",
    createdAt: now,
    updatedAt: now,
  });

  it("returns an empty object for no costs", () => {
    expect(aggregateCosts([], [])).toEqual({});
  });

  it("combines repeated categories", () => {
    expect(
      aggregateCosts(
        [maintenance("brakes", 100), maintenance("brakes", 200)],
        [expense("fuel", 300), expense("fuel", 400)],
      ),
    ).toEqual({
      "expense:fuel": 700,
      "maintenance:brakes": 300,
    });
  });

  it("keeps expense and maintenance namespaces separate", () => {
    expect(aggregateCosts([maintenance("inspection", 100)], [expense("inspection", 200)])).toEqual({
      "expense:inspection": 200,
      "maintenance:inspection": 100,
    });
  });

  it("sorts category keys deterministically", () => {
    expect(
      Object.keys(
        aggregateCosts(
          [maintenance("tires", 1), maintenance("brakes", 1)],
          [expense("toll", 1), expense("fuel", 1)],
        ),
      ),
    ).toEqual(["expense:fuel", "expense:toll", "maintenance:brakes", "maintenance:tires"]);
  });
});

describe("document path policy", () => {
  const root = path.resolve("/garage/documents");

  it.each([
    ["/garage/documents/invoice.pdf", "/garage/documents/invoice.pdf"],
    ["/garage/documents/sub/receipt.pdf", "/garage/documents/sub/receipt.pdf"],
    ["/garage/documents", "/garage/documents"],
    ["/garage/documents/sub/../invoice.pdf", "/garage/documents/invoice.pdf"],
  ])("allows path inside root %#", (input, expected) => {
    expect(validateDocumentPath(input, root)).toBe(expected);
  });

  it.each([
    "/garage/secret.pdf",
    "/garage/documents-other/file.pdf",
    "/garage/documents/../secret.pdf",
    "/tmp/file.pdf",
  ])("rejects path outside root %s", (input) => {
    expect(validateDocumentPath(input, root)).toBeNull();
  });

  it("resolves relative paths against the process directory without a root", () => {
    expect(validateDocumentPath("invoice.pdf")).toBe(path.resolve("invoice.pdf"));
  });
});

test.prop([fc.nat({ max: 10_000_000 }), fc.integer({ min: 1, max: 100_000 })])(
  "mileage recurrence advances by exactly recurrenceKm",
  (dueMileageKm, recurrenceKm) => {
    const next = nextReminderOccurrence(
      reminder({
        dueDate: undefined,
        dueMileageKm,
        recurrenceKm,
      }),
    );
    expect(next?.dueMileageKm).toBe(dueMileageKm + recurrenceKm);
  },
);

test.prop([fc.nat({ max: 100 }), fc.nat({ max: 1_000_000 })])(
  "part totals are exact multiplication",
  (quantity, unitPriceCents) => {
    expect(partTotal(quantity, unitPriceCents)).toBe(quantity * unitPriceCents);
  },
);

test.prop([fc.array(fc.nat({ max: 1_000_000 }), { maxLength: 100 })])(
  "sumPartTotals preserves the mathematical sum",
  (amounts) => {
    expect(sumPartTotals(amounts.map((totalPriceCents) => ({ totalPriceCents })))).toBe(
      amounts.reduce((total, amount) => total + amount, 0),
    );
  },
);
