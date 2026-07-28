import { Data } from "effect";

export class VehicleNotFound extends Data.TaggedError("VehicleNotFound")<{
  readonly vehicleId: string;
}> {}

export class InvalidMileage extends Data.TaggedError("InvalidMileage")<{
  readonly reason: string;
}> {}

export class MileageRegression extends Data.TaggedError("MileageRegression")<{
  readonly attempted: number;
  readonly current: number;
}> {}

export class MaintenanceEventNotFound extends Data.TaggedError("MaintenanceEventNotFound")<{
  readonly maintenanceEventId: string;
}> {}

export class ExpenseNotFound extends Data.TaggedError("ExpenseNotFound")<{
  readonly expenseId: string;
}> {}

export class ReminderNotFound extends Data.TaggedError("ReminderNotFound")<{
  readonly reminderId: string;
}> {}

export class DocumentNotFound extends Data.TaggedError("DocumentNotFound")<{
  readonly documentId: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string;
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly operation: string;
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  readonly message: string;
}> {}

export type DomainError =
  | VehicleNotFound
  | InvalidMileage
  | MileageRegression
  | MaintenanceEventNotFound
  | ExpenseNotFound
  | ReminderNotFound
  | DocumentNotFound
  | ValidationError
  | DatabaseError;
