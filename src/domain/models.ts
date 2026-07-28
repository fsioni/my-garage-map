import { Schema } from "effect";

const brandedUuid = <Brand extends string>(brand: Brand) => Schema.UUID.pipe(Schema.brand(brand));

export const VehicleIdSchema = brandedUuid("VehicleId");
export type VehicleId = typeof VehicleIdSchema.Type;
export const MileageRecordIdSchema = brandedUuid("MileageRecordId");
export type MileageRecordId = typeof MileageRecordIdSchema.Type;
export const MaintenanceEventIdSchema = brandedUuid("MaintenanceEventId");
export type MaintenanceEventId = typeof MaintenanceEventIdSchema.Type;
export const PartIdSchema = brandedUuid("PartId");
export type PartId = typeof PartIdSchema.Type;
export const ExpenseIdSchema = brandedUuid("ExpenseId");
export type ExpenseId = typeof ExpenseIdSchema.Type;
export const ReminderIdSchema = brandedUuid("ReminderId");
export type ReminderId = typeof ReminderIdSchema.Type;
export const DocumentIdSchema = brandedUuid("DocumentId");
export type DocumentId = typeof DocumentIdSchema.Type;

export const createId = <A, I>(schema: Schema.Schema<A, I>): A =>
  Schema.decodeUnknownSync(schema)(crypto.randomUUID());

export const mileageSources = ["manual", "maintenance", "fuel", "import"] as const;
export type MileageSource = (typeof mileageSources)[number];

export const maintenanceCategories = [
  "engine_oil",
  "filters",
  "brakes",
  "tires",
  "timing",
  "battery",
  "suspension",
  "transmission",
  "inspection",
  "bodywork",
  "cleaning",
  "electronics",
  "other",
] as const;
export type MaintenanceCategory = (typeof maintenanceCategories)[number];

export const expenseCategories = [
  "purchase",
  "insurance",
  "registration",
  "fuel",
  "toll",
  "parking",
  "maintenance",
  "repair",
  "accessory",
  "cleaning",
  "inspection",
  "tax",
  "transport",
  "other",
] as const;
export type ExpenseCategory = (typeof expenseCategories)[number];

export interface Vehicle {
  readonly id: VehicleId;
  readonly name: string;
  readonly make: string;
  readonly model: string;
  readonly registrationNumber?: string | undefined;
  readonly vin?: string | undefined;
  readonly firstRegistrationDate?: string | undefined;
  readonly purchaseDate?: string | undefined;
  readonly purchasePriceCents?: number | undefined;
  readonly currency: string;
  readonly initialMileageKm: number;
  readonly notes?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MileageRecord {
  readonly id: MileageRecordId;
  readonly vehicleId: VehicleId;
  readonly mileageKm: number;
  readonly recordedAt: string;
  readonly source: MileageSource;
  readonly notes?: string | undefined;
  readonly createdAt: string;
}

export interface Part {
  readonly id: PartId;
  readonly maintenanceEventId: MaintenanceEventId;
  readonly name: string;
  readonly manufacturer?: string | undefined;
  readonly reference?: string | undefined;
  readonly quantity: number;
  readonly unitPriceCents: number;
  readonly totalPriceCents: number;
}

export interface MaintenanceEvent {
  readonly id: MaintenanceEventId;
  readonly vehicleId: VehicleId;
  readonly title: string;
  readonly category: MaintenanceCategory;
  readonly performedAt: string;
  readonly mileageKm: number;
  readonly laborCostCents: number;
  readonly partsCostCents: number;
  readonly totalCostCents: number;
  readonly workshop?: string | undefined;
  readonly notes?: string | undefined;
  readonly parts: readonly Part[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Expense {
  readonly id: ExpenseId;
  readonly vehicleId: VehicleId;
  readonly category: ExpenseCategory;
  readonly description: string;
  readonly amountCents: number;
  readonly incurredAt: string;
  readonly mileageKm?: number | undefined;
  readonly vendor?: string | undefined;
  readonly notes?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Reminder {
  readonly id: ReminderId;
  readonly vehicleId: VehicleId;
  readonly title: string;
  readonly category: MaintenanceCategory;
  readonly dueDate?: string | undefined;
  readonly dueMileageKm?: number | undefined;
  readonly recurrenceMonths?: number | undefined;
  readonly recurrenceKm?: number | undefined;
  readonly completedAt?: string | undefined;
  readonly notes?: string | undefined;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReminderStatus = "upcoming" | "due" | "overdue" | "completed";

export interface Document {
  readonly id: DocumentId;
  readonly vehicleId: VehicleId;
  readonly maintenanceEventId?: MaintenanceEventId | undefined;
  readonly expenseId?: ExpenseId | undefined;
  readonly type: string;
  readonly title: string;
  readonly localPath: string;
  readonly mimeType?: string | undefined;
  readonly recordedAt: string;
  readonly notes?: string | undefined;
  readonly createdAt: string;
}

export interface Page {
  readonly limit: number;
  readonly offset: number;
}

export interface VehicleSummary {
  readonly vehicle: Vehicle;
  readonly currentMileageKm: number;
  readonly lastMaintenance: { readonly performedAt: string; readonly mileageKm: number } | null;
  readonly recentMaintenance: readonly MaintenanceEvent[];
  readonly reminders: readonly (Reminder & { readonly status: ReminderStatus })[];
  readonly totalExpensesCents: number;
  readonly totalMaintenanceCents: number;
  readonly totalRecordedCostCents: number;
  readonly costPerKmCents: number | null;
  readonly costByCategory: Readonly<Record<string, number>>;
}
