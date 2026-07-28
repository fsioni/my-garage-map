import { fc, test } from "@fast-check/vitest";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/config.js";
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
const baseReminder: Reminder = {
  id: createId(ReminderIdSchema),
  vehicleId,
  title: "Brakes",
  category: "brakes",
  dueDate: "2026-06-30",
  dueMileageKm: 20_000,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("domain rules", () => {
  it.each([
    ["12", 1_200],
    ["12.5", 1_250],
    ["12.50", 1_250],
    ["0", 0],
    ["12.345", null],
    ["-3", null],
    ["12,50", null],
    ["01", null],
    ["", null],
  ])("parses money %s", (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it("normalizes VIN and validates primitives", () => {
    expect(normalizeVin(" vf3abc ")).toBe("VF3ABC");
    expect(normalizeVin(" ")).toBeUndefined();
    expect(normalizeVin(undefined)).toBeUndefined();
    expect(nonEmpty(" car ")).toBe(true);
    expect(nonEmpty(" ")).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.2)).toBe(false);
    expect(isIsoDate("2026-01-02")).toBe(true);
    expect(isIsoDate("not-a-date")).toBe(false);
  });

  it("calculates maintenance and part totals", () => {
    expect(partTotal(3, 250)).toBe(750);
    expect(sumPartTotals([{ totalPriceCents: 200 }, { totalPriceCents: 300 }])).toBe(500);
    expect(maintenanceTotal(1_000, 500)).toBe(1_500);
  });

  it.each([
    [{ completedAt: "2026-01-01T00:00:00.000Z" }, 10_000, "2026-06-01", "completed"],
    [{ dueDate: "2026-05-01" }, 10_000, "2026-06-01", "overdue"],
    [{ dueMileageKm: 9_000 }, 10_000, "2026-01-01", "overdue"],
    [{ dueDate: "2026-06-20" }, 10_000, "2026-06-01", "due"],
    [{ dueMileageKm: 10_500 }, 10_000, "2026-01-01", "due"],
    [{ dueDate: "2027-01-01" }, 10_000, "2026-01-01", "upcoming"],
  ])("computes reminder status", (changes, mileage, now, expected) => {
    expect(reminderStatus({ ...baseReminder, ...changes }, mileage, now)).toBe(expected);
  });

  it("creates the next recurrence from the previous due values", () => {
    expect(
      nextReminderOccurrence({
        ...baseReminder,
        dueDate: "2024-01-31",
        recurrenceMonths: 1,
        recurrenceKm: 5_000,
      }),
    ).toMatchObject({ dueDate: "2024-02-29", dueMileageKm: 25_000 });
    expect(nextReminderOccurrence(baseReminder)).toBeNull();
  });

  it("calculates cost per km and deterministic category aggregation", () => {
    expect(costPerKm(10_000, 2_000, 1_000)).toBe(10);
    expect(costPerKm(10_000, 1_000, 1_000)).toBeNull();
    const maintenance: MaintenanceEvent = {
      id: createId(MaintenanceEventIdSchema),
      vehicleId,
      title: "Oil",
      category: "engine_oil",
      performedAt: "2026-01-01",
      mileageKm: 2_000,
      laborCostCents: 1_000,
      partsCostCents: 500,
      totalCostCents: 1_500,
      parts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const expense: Expense = {
      id: createId(ExpenseIdSchema),
      vehicleId,
      category: "fuel",
      description: "Fuel",
      amountCents: 5_000,
      incurredAt: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(aggregateCosts([maintenance], [expense])).toEqual({
      "expense:fuel": 5_000,
      "maintenance:engine_oil": 1_500,
    });
  });

  it("protects document roots", () => {
    expect(validateDocumentPath("/garage/docs/invoice.pdf", "/garage/docs")).toBe(
      "/garage/docs/invoice.pdf",
    );
    expect(validateDocumentPath("/garage/secret.pdf", "/garage/docs")).toBeNull();
    expect(validateDocumentPath("/tmp/file.pdf")).toBe("/tmp/file.pdf");
  });
});

test.prop([fc.nat({ max: 10_000_000 })])("money formatting round-trips cents", (cents) => {
  expect(parseMoney(formatMoney(cents))).toBe(cents);
});

test.prop([fc.nat(), fc.nat()])("mileage monotonicity matches ordering", (current, candidate) => {
  expect(acceptsMileage(current, candidate)).toBe(candidate >= current);
});

test.prop([fc.nat(), fc.array(fc.nat(), { maxLength: 50 })])(
  "cost aggregation loses no cents",
  (seed, amounts) => {
    const expenses: Expense[] = amounts.map((amountCents) => ({
      id: createId(ExpenseIdSchema),
      vehicleId,
      category: seed % 2 === 0 ? "fuel" : "parking",
      description: "Property",
      amountCents,
      incurredAt: "2026-01-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }));
    const total = Object.values(aggregateCosts([], expenses)).reduce(
      (sum, amount) => sum + amount,
      0,
    );
    expect(total).toBe(amounts.reduce((sum, amount) => sum + amount, 0));
  },
);

describe("configuration", () => {
  it("loads defaults and validates log levels", async () => {
    const config = await Effect.runPromise(loadConfig({}));
    expect(config.dbPath.endsWith("data/garage.sqlite")).toBe(true);
    expect(config.logLevel).toBe("info");
    await expect(Effect.runPromise(loadConfig({ GARAGE_LOG_LEVEL: "verbose" }))).rejects.toThrow(
      "GARAGE_LOG_LEVEL",
    );
  });
});
