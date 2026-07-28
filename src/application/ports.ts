import { Context, type Effect } from "effect";
import type { DomainError } from "../domain/errors.js";
import type {
  Document,
  DocumentId,
  Expense,
  ExpenseCategory,
  ExpenseId,
  MaintenanceCategory,
  MaintenanceEvent,
  MaintenanceEventId,
  MileageRecord,
  MileageSource,
  Page,
  Reminder,
  ReminderId,
  Vehicle,
  VehicleId,
  VehicleSummary,
} from "../domain/models.js";

export interface CreateVehicleInput {
  readonly name: string;
  readonly make: string;
  readonly model: string;
  readonly registrationNumber?: string;
  readonly vin?: string;
  readonly firstRegistrationDate?: string;
  readonly purchaseDate?: string;
  readonly purchasePriceCents?: number;
  readonly currency?: string;
  readonly initialMileageKm: number;
  readonly notes?: string;
}

export interface UpdateVehicleInput {
  readonly name?: string;
  readonly make?: string;
  readonly model?: string;
  readonly registrationNumber?: string | null;
  readonly vin?: string | null;
  readonly firstRegistrationDate?: string | null;
  readonly purchaseDate?: string | null;
  readonly purchasePriceCents?: number | null;
  readonly currency?: string;
  readonly notes?: string | null;
}

export interface RecordMileageInput {
  readonly vehicleId: VehicleId;
  readonly mileageKm: number;
  readonly recordedAt: string;
  readonly source: MileageSource;
  readonly notes?: string;
}

export interface PartInput {
  readonly name: string;
  readonly manufacturer?: string;
  readonly reference?: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export interface AddMaintenanceInput {
  readonly vehicleId: VehicleId;
  readonly title: string;
  readonly category: MaintenanceCategory;
  readonly performedAt: string;
  readonly mileageKm: number;
  readonly laborCostCents: number;
  readonly parts: readonly PartInput[];
  readonly workshop?: string;
  readonly notes?: string;
}

export interface UpdateMaintenanceInput {
  readonly title?: string;
  readonly category?: MaintenanceCategory;
  readonly performedAt?: string;
  readonly mileageKm?: number;
  readonly laborCostCents?: number;
  readonly parts?: readonly PartInput[];
  readonly workshop?: string | null;
  readonly notes?: string | null;
}

export interface AddExpenseInput {
  readonly vehicleId: VehicleId;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly amountCents: number;
  readonly incurredAt: string;
  readonly mileageKm?: number;
  readonly vendor?: string;
  readonly notes?: string;
}

export interface UpdateExpenseInput {
  readonly category?: ExpenseCategory;
  readonly description?: string;
  readonly amountCents?: number;
  readonly incurredAt?: string;
  readonly mileageKm?: number | null;
  readonly vendor?: string | null;
  readonly notes?: string | null;
}

export interface AddReminderInput {
  readonly vehicleId: VehicleId;
  readonly title: string;
  readonly category: MaintenanceCategory;
  readonly dueDate?: string;
  readonly dueMileageKm?: number;
  readonly recurrenceMonths?: number;
  readonly recurrenceKm?: number;
  readonly notes?: string;
}

export interface AttachDocumentInput {
  readonly vehicleId: VehicleId;
  readonly maintenanceEventId?: MaintenanceEventId;
  readonly expenseId?: ExpenseId;
  readonly type: string;
  readonly title: string;
  readonly localPath: string;
  readonly mimeType?: string;
  readonly recordedAt: string;
  readonly notes?: string;
}

type Result<A> = Effect.Effect<A, DomainError>;

export interface GarageRepositoryService {
  readonly createVehicle: (input: CreateVehicleInput, now: string) => Result<Vehicle>;
  readonly listVehicles: (page: Page) => Result<readonly Vehicle[]>;
  readonly getVehicle: (id: VehicleId) => Result<Vehicle>;
  readonly updateVehicle: (
    id: VehicleId,
    input: UpdateVehicleInput,
    now: string,
  ) => Result<Vehicle>;
  readonly recordMileage: (input: RecordMileageInput, now: string) => Result<MileageRecord>;
  readonly getCurrentMileage: (vehicleId: VehicleId) => Result<number>;
  readonly listMileageRecords: (
    vehicleId: VehicleId,
    page: Page,
  ) => Result<readonly MileageRecord[]>;
  readonly addMaintenance: (input: AddMaintenanceInput, now: string) => Result<MaintenanceEvent>;
  readonly getMaintenance: (id: MaintenanceEventId) => Result<MaintenanceEvent>;
  readonly listMaintenance: (
    vehicleId: VehicleId,
    page: Page,
  ) => Result<readonly MaintenanceEvent[]>;
  readonly updateMaintenance: (
    id: MaintenanceEventId,
    input: UpdateMaintenanceInput,
    now: string,
  ) => Result<MaintenanceEvent>;
  readonly deleteMaintenance: (id: MaintenanceEventId) => Result<void>;
  readonly addExpense: (input: AddExpenseInput, now: string) => Result<Expense>;
  readonly listExpenses: (vehicleId: VehicleId, page: Page) => Result<readonly Expense[]>;
  readonly updateExpense: (
    id: ExpenseId,
    input: UpdateExpenseInput,
    now: string,
  ) => Result<Expense>;
  readonly deleteExpense: (id: ExpenseId) => Result<void>;
  readonly addReminder: (input: AddReminderInput, now: string) => Result<Reminder>;
  readonly listReminders: (vehicleId: VehicleId, page: Page) => Result<readonly Reminder[]>;
  readonly completeReminder: (
    id: ReminderId,
    now: string,
  ) => Result<{ readonly completed: Reminder; readonly next: Reminder | null }>;
  readonly attachDocument: (input: AttachDocumentInput, now: string) => Result<Document>;
  readonly listDocuments: (vehicleId: VehicleId, page: Page) => Result<readonly Document[]>;
  readonly removeDocument: (id: DocumentId) => Result<void>;
  readonly getVehicleSummary: (vehicleId: VehicleId, now: string) => Result<VehicleSummary>;
}

export class GarageRepository extends Context.Tag("garage/GarageRepository")<
  GarageRepository,
  GarageRepositoryService
>() {}

export interface ClockService {
  readonly now: Effect.Effect<string>;
}

export class AppClock extends Context.Tag("garage/AppClock")<AppClock, ClockService>() {}

export interface DocumentStorageService {
  readonly validate: (localPath: string) => Effect.Effect<string, DomainError>;
}

export class DocumentStorage extends Context.Tag("garage/DocumentStorage")<
  DocumentStorage,
  DocumentStorageService
>() {}
