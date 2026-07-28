import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const vehicles = sqliteTable(
  "vehicles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    registrationNumber: text("registration_number"),
    vin: text("vin"),
    firstRegistrationDate: text("first_registration_date"),
    purchaseDate: text("purchase_date"),
    purchasePriceCents: integer("purchase_price_cents"),
    currency: text("currency").notNull().default("EUR"),
    initialMileageKm: integer("initial_mileage_km").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("vehicles_name_not_empty", sql`length(trim(${table.name})) > 0`),
    check("vehicles_make_not_empty", sql`length(trim(${table.make})) > 0`),
    check("vehicles_model_not_empty", sql`length(trim(${table.model})) > 0`),
    check("vehicles_initial_mileage_nonnegative", sql`${table.initialMileageKm} >= 0`),
    check(
      "vehicles_purchase_price_nonnegative",
      sql`${table.purchasePriceCents} is null or ${table.purchasePriceCents} >= 0`,
    ),
    uniqueIndex("vehicles_registration_number_idx").on(table.registrationNumber),
    uniqueIndex("vehicles_vin_idx").on(table.vin),
  ],
);

export const mileageRecords = sqliteTable(
  "mileage_records",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    mileageKm: integer("mileage_km").notNull(),
    recordedAt: text("recorded_at").notNull(),
    source: text("source").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check("mileage_records_mileage_nonnegative", sql`${table.mileageKm} >= 0`),
    uniqueIndex("mileage_records_dedup_idx").on(
      table.vehicleId,
      table.mileageKm,
      table.recordedAt,
      table.source,
    ),
    index("mileage_records_vehicle_recorded_idx").on(table.vehicleId, table.recordedAt),
  ],
);

export const maintenanceEvents = sqliteTable(
  "maintenance_events",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    performedAt: text("performed_at").notNull(),
    mileageKm: integer("mileage_km").notNull(),
    laborCostCents: integer("labor_cost_cents").notNull(),
    partsCostCents: integer("parts_cost_cents").notNull(),
    totalCostCents: integer("total_cost_cents").notNull(),
    workshop: text("workshop"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("maintenance_mileage_nonnegative", sql`${table.mileageKm} >= 0`),
    check("maintenance_labor_cost_nonnegative", sql`${table.laborCostCents} >= 0`),
    check("maintenance_parts_cost_nonnegative", sql`${table.partsCostCents} >= 0`),
    check(
      "maintenance_total_consistent",
      sql`${table.totalCostCents} = ${table.laborCostCents} + ${table.partsCostCents}`,
    ),
    index("maintenance_vehicle_performed_idx").on(table.vehicleId, table.performedAt),
  ],
);

export const parts = sqliteTable(
  "parts",
  {
    id: text("id").primaryKey(),
    maintenanceEventId: text("maintenance_event_id")
      .notNull()
      .references(() => maintenanceEvents.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    reference: text("reference"),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
  },
  (table) => [
    check("parts_quantity_positive", sql`${table.quantity} > 0`),
    check("parts_unit_price_nonnegative", sql`${table.unitPriceCents} >= 0`),
    check(
      "parts_total_consistent",
      sql`${table.totalPriceCents} = ${table.quantity} * ${table.unitPriceCents}`,
    ),
    index("parts_maintenance_idx").on(table.maintenanceEventId),
  ],
);

export const expenses = sqliteTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    category: text("category").notNull(),
    description: text("description").notNull(),
    amountCents: integer("amount_cents").notNull(),
    incurredAt: text("incurred_at").notNull(),
    mileageKm: integer("mileage_km"),
    vendor: text("vendor"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check("expenses_amount_nonnegative", sql`${table.amountCents} >= 0`),
    check(
      "expenses_mileage_nonnegative",
      sql`${table.mileageKm} is null or ${table.mileageKm} >= 0`,
    ),
    index("expenses_vehicle_incurred_idx").on(table.vehicleId, table.incurredAt),
  ],
);

export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    category: text("category").notNull(),
    dueDate: text("due_date"),
    dueMileageKm: integer("due_mileage_km"),
    recurrenceMonths: integer("recurrence_months"),
    recurrenceKm: integer("recurrence_km"),
    completedAt: text("completed_at"),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    check(
      "reminders_has_due",
      sql`${table.dueDate} is not null or ${table.dueMileageKm} is not null`,
    ),
    check(
      "reminders_due_mileage_nonnegative",
      sql`${table.dueMileageKm} is null or ${table.dueMileageKm} >= 0`,
    ),
    check(
      "reminders_recurrence_months_positive",
      sql`${table.recurrenceMonths} is null or ${table.recurrenceMonths} > 0`,
    ),
    check(
      "reminders_recurrence_km_positive",
      sql`${table.recurrenceKm} is null or ${table.recurrenceKm} > 0`,
    ),
    index("reminders_vehicle_idx").on(table.vehicleId),
  ],
);

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    vehicleId: text("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    maintenanceEventId: text("maintenance_event_id").references(() => maintenanceEvents.id, {
      onDelete: "restrict",
    }),
    expenseId: text("expense_id").references(() => expenses.id, { onDelete: "restrict" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    localPath: text("local_path").notNull(),
    mimeType: text("mime_type"),
    recordedAt: text("recorded_at").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    check(
      "documents_single_parent",
      sql`not (${table.maintenanceEventId} is not null and ${table.expenseId} is not null)`,
    ),
    index("documents_vehicle_idx").on(table.vehicleId),
    index("documents_maintenance_idx").on(table.maintenanceEventId),
    index("documents_expense_idx").on(table.expenseId),
  ],
);
