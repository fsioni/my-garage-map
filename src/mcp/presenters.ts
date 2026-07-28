import type { DomainError } from "../domain/errors.js";

export interface PresentedError {
  readonly code: string;
  readonly message: string;
}

export const presentError = (error: DomainError): PresentedError => {
  switch (error._tag) {
    case "VehicleNotFound":
      return { code: error._tag, message: `Vehicle ${error.vehicleId} was not found` };
    case "MaintenanceEventNotFound":
      return {
        code: error._tag,
        message: `Maintenance event ${error.maintenanceEventId} was not found`,
      };
    case "ExpenseNotFound":
      return { code: error._tag, message: `Expense ${error.expenseId} was not found` };
    case "ReminderNotFound":
      return { code: error._tag, message: `Reminder ${error.reminderId} was not found` };
    case "DocumentNotFound":
      return { code: error._tag, message: `Document ${error.documentId} was not found` };
    case "MileageRegression":
      return {
        code: error._tag,
        message: `Mileage ${error.attempted} km is below current mileage ${error.current} km`,
      };
    case "InvalidMileage":
      return { code: error._tag, message: error.reason };
    case "ValidationError":
      return { code: error._tag, message: error.message };
    case "DatabaseError":
      return { code: error._tag, message: `Database operation failed: ${error.operation}` };
  }
};

export const presentUnknownError = (error: unknown): PresentedError => {
  if (typeof error === "object" && error !== null && "_tag" in error) {
    const tag = error._tag;
    if (typeof tag === "string") {
      const messages: Readonly<Record<string, string>> = {
        VehicleNotFound: "The requested vehicle was not found",
        MaintenanceEventNotFound: "The requested maintenance event was not found",
        ExpenseNotFound: "The requested expense was not found",
        ReminderNotFound: "The requested reminder was not found",
        DocumentNotFound: "The requested document was not found",
        MileageRegression: "The mileage would regress below the current value",
        InvalidMileage: "The mileage is invalid",
        ValidationError: "The request violates a business rule",
        DatabaseError: "The database operation failed",
      };
      const message = messages[tag];
      if (message !== undefined) return { code: tag, message };
    }
  }
  return { code: "InternalError", message: "An unexpected internal error occurred" };
};
