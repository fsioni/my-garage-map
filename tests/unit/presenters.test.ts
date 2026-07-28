import { describe, expect, it } from "vitest";
import {
  DatabaseError,
  DocumentNotFound,
  ExpenseNotFound,
  InvalidMileage,
  MaintenanceEventNotFound,
  MileageRegression,
  ReminderNotFound,
  ValidationError,
  VehicleNotFound,
} from "../../src/domain/errors.js";
import { presentError, presentUnknownError } from "../../src/mcp/presenters.js";

describe("MCP error presentation", () => {
  it.each([
    new VehicleNotFound({ vehicleId: "v" }),
    new MaintenanceEventNotFound({ maintenanceEventId: "m" }),
    new ExpenseNotFound({ expenseId: "e" }),
    new ReminderNotFound({ reminderId: "r" }),
    new DocumentNotFound({ documentId: "d" }),
    new MileageRegression({ attempted: 1, current: 2 }),
    new InvalidMileage({ reason: "bad" }),
    new ValidationError({ message: "bad input" }),
    new DatabaseError({ operation: "query" }),
  ])("maps %s without infrastructure details", (error) => {
    const presented = presentError(error);
    expect(presented.code).toBe(error._tag);
    expect(presented.message).not.toContain("SQLITE");
  });

  it("redacts unknown errors", () => {
    expect(presentUnknownError(new Error("secret stack"))).toEqual({
      code: "InternalError",
      message: "An unexpected internal error occurred",
    });
    expect(presentUnknownError({ _tag: "VehicleNotFound" }).code).toBe("VehicleNotFound");
  });
});
