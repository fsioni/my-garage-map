import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Context, Effect, Layer, Schema } from "effect";
import {
  type AddMaintenanceInput,
  type AttachDocumentInput,
  GarageRepository,
  type GarageRepositoryService,
  type RecordMileageInput,
  type UpdateExpenseInput,
  type UpdateMaintenanceInput,
} from "../../application/ports.js";
import type { DomainError } from "../../domain/errors.js";
import {
  DatabaseError,
  DocumentNotFound,
  ExpenseNotFound,
  InvalidMileage,
  MaintenanceEventNotFound,
  MileageRegression,
  ReminderNotFound,
  VehicleNotFound,
} from "../../domain/errors.js";
import {
  createId,
  DocumentIdSchema,
  type Document,
  ExpenseIdSchema,
  expenseCategories,
  type Expense,
  MaintenanceEventIdSchema,
  maintenanceCategories,
  type MaintenanceEvent,
  MileageRecordIdSchema,
  mileageSources,
  type MileageRecord,
  PartIdSchema,
  type Part,
  ReminderIdSchema,
  type Reminder,
  VehicleIdSchema,
  type Vehicle,
  type VehicleId,
  type VehicleSummary,
} from "../../domain/models.js";
import {
  acceptsMileage,
  aggregateCosts,
  costPerKm,
  maintenanceTotal,
  nextReminderOccurrence,
  partTotal,
  reminderStatus,
  sumPartTotals,
} from "../../domain/rules.js";
import {
  documents,
  expenses,
  maintenanceEvents,
  mileageRecords,
  parts,
  reminders,
  vehicles,
} from "./schema.js";

export interface SqliteConnectionService {
  readonly sqlite: Database.Database;
  readonly db: BetterSQLite3Database;
}

export class SqliteConnection extends Context.Tag("garage/SqliteConnection")<
  SqliteConnection,
  SqliteConnectionService
>() {}

const migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url));

export const sqliteConnectionLayer = (dbPath: string) =>
  Layer.scoped(
    SqliteConnection,
    Effect.acquireRelease(
      Effect.try({
        try: () => {
          if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
          const sqlite = new Database(dbPath);
          sqlite.pragma("foreign_keys = ON");
          sqlite.pragma("journal_mode = WAL");
          const db = drizzle(sqlite);
          migrate(db, { migrationsFolder });
          return { sqlite, db };
        },
        catch: () => new DatabaseError({ operation: "open database" }),
      }),
      ({ sqlite }) => Effect.sync(() => sqlite.close()),
    ),
  );

const decode = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A =>
  Schema.decodeUnknownSync(schema)(value);
const optional = <A>(value: A | null): A | undefined => value ?? undefined;
const required = <A>(value: A | undefined): A => {
  if (value === undefined) throw new Error("Database invariant violated");
  return value;
};
const maintenanceCategorySchema = Schema.Literal(...maintenanceCategories);
const expenseCategorySchema = Schema.Literal(...expenseCategories);
const mileageSourceSchema = Schema.Literal(...mileageSources);

const toVehicle = (row: typeof vehicles.$inferSelect): Vehicle => ({
  id: decode(VehicleIdSchema, row.id),
  name: row.name,
  make: row.make,
  model: row.model,
  ...(row.registrationNumber === null ? {} : { registrationNumber: row.registrationNumber }),
  ...(row.vin === null ? {} : { vin: row.vin }),
  ...(row.firstRegistrationDate === null
    ? {}
    : { firstRegistrationDate: row.firstRegistrationDate }),
  ...(row.purchaseDate === null ? {} : { purchaseDate: row.purchaseDate }),
  ...(row.purchasePriceCents === null ? {} : { purchasePriceCents: row.purchasePriceCents }),
  currency: row.currency,
  initialMileageKm: row.initialMileageKm,
  ...(row.notes === null ? {} : { notes: row.notes }),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toMileage = (row: typeof mileageRecords.$inferSelect): MileageRecord => ({
  id: decode(MileageRecordIdSchema, row.id),
  vehicleId: decode(VehicleIdSchema, row.vehicleId),
  mileageKm: row.mileageKm,
  recordedAt: row.recordedAt,
  source: decode(mileageSourceSchema, row.source),
  ...(row.notes === null ? {} : { notes: row.notes }),
  createdAt: row.createdAt,
});

const toPart = (row: typeof parts.$inferSelect): Part => ({
  id: decode(PartIdSchema, row.id),
  maintenanceEventId: decode(MaintenanceEventIdSchema, row.maintenanceEventId),
  name: row.name,
  ...(row.manufacturer === null ? {} : { manufacturer: row.manufacturer }),
  ...(row.reference === null ? {} : { reference: row.reference }),
  quantity: row.quantity,
  unitPriceCents: row.unitPriceCents,
  totalPriceCents: row.totalPriceCents,
});

const toMaintenance = (
  row: typeof maintenanceEvents.$inferSelect,
  eventParts: readonly Part[],
): MaintenanceEvent => ({
  id: decode(MaintenanceEventIdSchema, row.id),
  vehicleId: decode(VehicleIdSchema, row.vehicleId),
  title: row.title,
  category: decode(maintenanceCategorySchema, row.category),
  performedAt: row.performedAt,
  mileageKm: row.mileageKm,
  laborCostCents: row.laborCostCents,
  partsCostCents: row.partsCostCents,
  totalCostCents: row.totalCostCents,
  ...(row.workshop === null ? {} : { workshop: row.workshop }),
  ...(row.notes === null ? {} : { notes: row.notes }),
  parts: eventParts,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toExpense = (row: typeof expenses.$inferSelect): Expense => ({
  id: decode(ExpenseIdSchema, row.id),
  vehicleId: decode(VehicleIdSchema, row.vehicleId),
  category: decode(expenseCategorySchema, row.category),
  description: row.description,
  amountCents: row.amountCents,
  incurredAt: row.incurredAt,
  ...(row.mileageKm === null ? {} : { mileageKm: row.mileageKm }),
  ...(row.vendor === null ? {} : { vendor: row.vendor }),
  ...(row.notes === null ? {} : { notes: row.notes }),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toReminder = (row: typeof reminders.$inferSelect): Reminder => ({
  id: decode(ReminderIdSchema, row.id),
  vehicleId: decode(VehicleIdSchema, row.vehicleId),
  title: row.title,
  category: decode(maintenanceCategorySchema, row.category),
  ...(row.dueDate === null ? {} : { dueDate: row.dueDate }),
  ...(row.dueMileageKm === null ? {} : { dueMileageKm: row.dueMileageKm }),
  ...(row.recurrenceMonths === null ? {} : { recurrenceMonths: row.recurrenceMonths }),
  ...(row.recurrenceKm === null ? {} : { recurrenceKm: row.recurrenceKm }),
  ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
  ...(row.notes === null ? {} : { notes: row.notes }),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toDocument = (row: typeof documents.$inferSelect): Document => ({
  id: decode(DocumentIdSchema, row.id),
  vehicleId: decode(VehicleIdSchema, row.vehicleId),
  ...(row.maintenanceEventId === null
    ? {}
    : { maintenanceEventId: decode(MaintenanceEventIdSchema, row.maintenanceEventId) }),
  ...(row.expenseId === null ? {} : { expenseId: decode(ExpenseIdSchema, row.expenseId) }),
  type: row.type,
  title: row.title,
  localPath: row.localPath,
  ...(row.mimeType === null ? {} : { mimeType: row.mimeType }),
  recordedAt: row.recordedAt,
  ...(row.notes === null ? {} : { notes: row.notes }),
  createdAt: row.createdAt,
});

const databaseEffect = <A>(operation: string, run: () => A): Effect.Effect<A, DomainError> =>
  Effect.try({
    try: run,
    catch: () => new DatabaseError({ operation }),
  });

const makeRepository = (db: BetterSQLite3Database): GarageRepositoryService => {
  const findVehicle = (id: VehicleId) =>
    databaseEffect("get vehicle", () =>
      db.select().from(vehicles).where(eq(vehicles.id, id)).get(),
    ).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.fail(new VehicleNotFound({ vehicleId: id }))
          : Effect.succeed(toVehicle(row)),
      ),
    );

  const currentMileage = (vehicleId: VehicleId) =>
    findVehicle(vehicleId).pipe(
      Effect.flatMap((vehicle) =>
        databaseEffect("get current mileage", () =>
          db
            .select()
            .from(mileageRecords)
            .where(eq(mileageRecords.vehicleId, vehicleId))
            .orderBy(
              desc(mileageRecords.recordedAt),
              desc(mileageRecords.createdAt),
              desc(mileageRecords.id),
            )
            .limit(1)
            .get(),
        ).pipe(Effect.map((row) => row?.mileageKm ?? vehicle.initialMileageKm)),
      ),
    );

  const loadParts = (maintenanceEventId: string): readonly Part[] =>
    db
      .select()
      .from(parts)
      .where(eq(parts.maintenanceEventId, maintenanceEventId))
      .orderBy(asc(parts.name), asc(parts.id))
      .all()
      .map(toPart);

  const findMaintenance = (id: string) =>
    databaseEffect("get maintenance", () =>
      db.select().from(maintenanceEvents).where(eq(maintenanceEvents.id, id)).get(),
    ).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.fail(new MaintenanceEventNotFound({ maintenanceEventId: id }))
          : Effect.succeed(toMaintenance(row, loadParts(row.id))),
      ),
    );

  const findExpense = (id: string) =>
    databaseEffect("get expense", () =>
      db.select().from(expenses).where(eq(expenses.id, id)).get(),
    ).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.fail(new ExpenseNotFound({ expenseId: id }))
          : Effect.succeed(toExpense(row)),
      ),
    );

  const findReminder = (id: string) =>
    databaseEffect("get reminder", () =>
      db.select().from(reminders).where(eq(reminders.id, id)).get(),
    ).pipe(
      Effect.flatMap((row) =>
        row === undefined
          ? Effect.fail(new ReminderNotFound({ reminderId: id }))
          : Effect.succeed(toReminder(row)),
      ),
    );

  const insertParts = (
    transaction: BetterSQLite3Database,
    eventId: string,
    inputParts: AddMaintenanceInput["parts"],
  ) => {
    if (inputParts.length === 0) return;
    transaction
      .insert(parts)
      .values(
        inputParts.map((part) => ({
          id: createId(PartIdSchema),
          maintenanceEventId: eventId,
          name: part.name.trim(),
          manufacturer: optional(part.manufacturer?.trim() ?? null),
          reference: optional(part.reference?.trim() ?? null),
          quantity: part.quantity,
          unitPriceCents: part.unitPriceCents,
          totalPriceCents: partTotal(part.quantity, part.unitPriceCents),
        })),
      )
      .run();
  };

  return {
    createVehicle: (input, now) =>
      databaseEffect("create vehicle", () => {
        const id = createId(VehicleIdSchema);
        db.insert(vehicles)
          .values({
            id,
            name: input.name.trim(),
            make: input.make.trim(),
            model: input.model.trim(),
            registrationNumber: input.registrationNumber,
            vin: input.vin,
            firstRegistrationDate: input.firstRegistrationDate,
            purchaseDate: input.purchaseDate,
            purchasePriceCents: input.purchasePriceCents,
            currency: input.currency ?? "EUR",
            initialMileageKm: input.initialMileageKm,
            notes: input.notes,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        return toVehicle(required(db.select().from(vehicles).where(eq(vehicles.id, id)).get()));
      }),
    listVehicles: (page) =>
      databaseEffect("list vehicles", () =>
        db
          .select()
          .from(vehicles)
          .orderBy(asc(vehicles.name), asc(vehicles.id))
          .limit(page.limit)
          .offset(page.offset)
          .all()
          .map(toVehicle),
      ),
    getVehicle: findVehicle,
    updateVehicle: (id, input, now) =>
      findVehicle(id).pipe(
        Effect.flatMap(() =>
          databaseEffect("update vehicle", () => {
            db.update(vehicles)
              .set({
                ...input,
                registrationNumber:
                  input.registrationNumber === undefined ? undefined : input.registrationNumber,
                vin: input.vin === undefined ? undefined : input.vin,
                firstRegistrationDate:
                  input.firstRegistrationDate === undefined
                    ? undefined
                    : input.firstRegistrationDate,
                purchaseDate: input.purchaseDate === undefined ? undefined : input.purchaseDate,
                purchasePriceCents:
                  input.purchasePriceCents === undefined ? undefined : input.purchasePriceCents,
                notes: input.notes === undefined ? undefined : input.notes,
                updatedAt: now,
              })
              .where(eq(vehicles.id, id))
              .run();
            return toVehicle(required(db.select().from(vehicles).where(eq(vehicles.id, id)).get()));
          }),
        ),
      ),
    recordMileage: (input: RecordMileageInput, now) =>
      currentMileage(input.vehicleId).pipe(
        Effect.flatMap((current) => {
          if (!acceptsMileage(current, input.mileageKm)) {
            return Effect.fail(
              new MileageRegression({
                attempted: input.mileageKm,
                current,
              }),
            );
          }
          return databaseEffect("check duplicate mileage", () =>
            db
              .select({ id: mileageRecords.id })
              .from(mileageRecords)
              .where(
                and(
                  eq(mileageRecords.vehicleId, input.vehicleId),
                  eq(mileageRecords.mileageKm, input.mileageKm),
                  eq(mileageRecords.recordedAt, input.recordedAt),
                  eq(mileageRecords.source, input.source),
                ),
              )
              .get(),
          ).pipe(
            Effect.flatMap((duplicate) =>
              duplicate === undefined
                ? databaseEffect("record mileage", () => {
                    const id = createId(MileageRecordIdSchema);
                    db.insert(mileageRecords)
                      .values({ id, ...input, createdAt: now })
                      .run();
                    return toMileage(
                      required(
                        db.select().from(mileageRecords).where(eq(mileageRecords.id, id)).get(),
                      ),
                    );
                  })
                : Effect.fail(
                    new InvalidMileage({
                      reason: "An identical mileage record already exists",
                    }),
                  ),
            ),
          );
        }),
      ),
    getCurrentMileage: currentMileage,
    listMileageRecords: (vehicleId, page) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("list mileage", () =>
            db
              .select()
              .from(mileageRecords)
              .where(eq(mileageRecords.vehicleId, vehicleId))
              .orderBy(
                desc(mileageRecords.recordedAt),
                desc(mileageRecords.createdAt),
                desc(mileageRecords.id),
              )
              .limit(page.limit)
              .offset(page.offset)
              .all()
              .map(toMileage),
          ),
        ),
      ),
    addMaintenance: (input, now) =>
      currentMileage(input.vehicleId).pipe(
        Effect.flatMap((current) =>
          acceptsMileage(current, input.mileageKm)
            ? databaseEffect("add maintenance", () => {
                const id = createId(MaintenanceEventIdSchema);
                const normalizedParts = input.parts.map((part) => ({
                  totalPriceCents: partTotal(part.quantity, part.unitPriceCents),
                }));
                const partsCostCents = sumPartTotals(normalizedParts);
                db.transaction((transaction) => {
                  transaction
                    .insert(maintenanceEvents)
                    .values({
                      id,
                      vehicleId: input.vehicleId,
                      title: input.title.trim(),
                      category: input.category,
                      performedAt: input.performedAt,
                      mileageKm: input.mileageKm,
                      laborCostCents: input.laborCostCents,
                      partsCostCents,
                      totalCostCents: maintenanceTotal(input.laborCostCents, partsCostCents),
                      workshop: input.workshop,
                      notes: input.notes,
                      createdAt: now,
                      updatedAt: now,
                    })
                    .run();
                  insertParts(transaction, id, input.parts);
                  if (input.mileageKm > current) {
                    transaction
                      .insert(mileageRecords)
                      .values({
                        id: createId(MileageRecordIdSchema),
                        vehicleId: input.vehicleId,
                        mileageKm: input.mileageKm,
                        recordedAt: input.performedAt,
                        source: "maintenance",
                        notes: `Created with maintenance: ${input.title.trim()}`,
                        createdAt: now,
                      })
                      .run();
                  }
                });
                const row = db
                  .select()
                  .from(maintenanceEvents)
                  .where(eq(maintenanceEvents.id, id))
                  .get();
                return toMaintenance(required(row), loadParts(id));
              })
            : Effect.fail(
                new MileageRegression({
                  attempted: input.mileageKm,
                  current,
                }),
              ),
        ),
      ),
    getMaintenance: findMaintenance,
    listMaintenance: (vehicleId, page) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("list maintenance", () =>
            db
              .select()
              .from(maintenanceEvents)
              .where(eq(maintenanceEvents.vehicleId, vehicleId))
              .orderBy(
                desc(maintenanceEvents.performedAt),
                desc(maintenanceEvents.createdAt),
                desc(maintenanceEvents.id),
              )
              .limit(page.limit)
              .offset(page.offset)
              .all()
              .map((row) => toMaintenance(row, loadParts(row.id))),
          ),
        ),
      ),
    updateMaintenance: (id, input: UpdateMaintenanceInput, now) =>
      findMaintenance(id).pipe(
        Effect.flatMap((existing) => {
          const nextMileage = input.mileageKm ?? existing.mileageKm;
          return currentMileage(existing.vehicleId).pipe(
            Effect.flatMap((current) =>
              nextMileage < existing.mileageKm && nextMileage < current
                ? Effect.fail(new MileageRegression({ attempted: nextMileage, current }))
                : databaseEffect("update maintenance", () => {
                    db.transaction((transaction) => {
                      let partsCostCents = existing.partsCostCents;
                      if (input.parts !== undefined) {
                        transaction.delete(parts).where(eq(parts.maintenanceEventId, id)).run();
                        insertParts(transaction, id, input.parts);
                        partsCostCents = input.parts.reduce(
                          (total, part) => total + partTotal(part.quantity, part.unitPriceCents),
                          0,
                        );
                      }
                      const laborCostCents = input.laborCostCents ?? existing.laborCostCents;
                      transaction
                        .update(maintenanceEvents)
                        .set({
                          ...input,
                          workshop: input.workshop === undefined ? undefined : input.workshop,
                          notes: input.notes === undefined ? undefined : input.notes,
                          partsCostCents,
                          totalCostCents: maintenanceTotal(laborCostCents, partsCostCents),
                          updatedAt: now,
                        })
                        .where(eq(maintenanceEvents.id, id))
                        .run();
                    });
                  }),
            ),
          );
        }),
        Effect.flatMap(() => findMaintenance(id)),
      ),
    deleteMaintenance: (id) =>
      findMaintenance(id).pipe(
        Effect.flatMap(() =>
          databaseEffect("delete maintenance", () => {
            db.transaction((transaction) => {
              transaction
                .update(documents)
                .set({ maintenanceEventId: null })
                .where(eq(documents.maintenanceEventId, id))
                .run();
              transaction.delete(parts).where(eq(parts.maintenanceEventId, id)).run();
              transaction.delete(maintenanceEvents).where(eq(maintenanceEvents.id, id)).run();
            });
          }),
        ),
      ),
    addExpense: (input, now) =>
      findVehicle(input.vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("add expense", () => {
            const id = createId(ExpenseIdSchema);
            db.insert(expenses)
              .values({ id, ...input, createdAt: now, updatedAt: now })
              .run();
            return toExpense(required(db.select().from(expenses).where(eq(expenses.id, id)).get()));
          }),
        ),
      ),
    listExpenses: (vehicleId, page) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("list expenses", () =>
            db
              .select()
              .from(expenses)
              .where(eq(expenses.vehicleId, vehicleId))
              .orderBy(desc(expenses.incurredAt), desc(expenses.createdAt), desc(expenses.id))
              .limit(page.limit)
              .offset(page.offset)
              .all()
              .map(toExpense),
          ),
        ),
      ),
    updateExpense: (id, input: UpdateExpenseInput, now) =>
      findExpense(id).pipe(
        Effect.flatMap(() =>
          databaseEffect("update expense", () => {
            db.update(expenses)
              .set({
                ...input,
                mileageKm: input.mileageKm === undefined ? undefined : input.mileageKm,
                vendor: input.vendor === undefined ? undefined : input.vendor,
                notes: input.notes === undefined ? undefined : input.notes,
                updatedAt: now,
              })
              .where(eq(expenses.id, id))
              .run();
          }),
        ),
        Effect.flatMap(() => findExpense(id)),
      ),
    deleteExpense: (id) =>
      findExpense(id).pipe(
        Effect.flatMap(() =>
          databaseEffect("delete expense", () => {
            db.transaction((transaction) => {
              transaction
                .update(documents)
                .set({ expenseId: null })
                .where(eq(documents.expenseId, id))
                .run();
              transaction.delete(expenses).where(eq(expenses.id, id)).run();
            });
          }),
        ),
      ),
    addReminder: (input, now) =>
      findVehicle(input.vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("add reminder", () => {
            const id = createId(ReminderIdSchema);
            db.insert(reminders)
              .values({ id, ...input, createdAt: now, updatedAt: now })
              .run();
            return toReminder(
              required(db.select().from(reminders).where(eq(reminders.id, id)).get()),
            );
          }),
        ),
      ),
    listReminders: (vehicleId, page) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("list reminders", () =>
            db
              .select()
              .from(reminders)
              .where(eq(reminders.vehicleId, vehicleId))
              .orderBy(asc(reminders.completedAt), asc(reminders.dueDate), asc(reminders.id))
              .limit(page.limit)
              .offset(page.offset)
              .all()
              .map(toReminder),
          ),
        ),
      ),
    completeReminder: (id, now) =>
      findReminder(id).pipe(
        Effect.flatMap((existing) =>
          databaseEffect("complete reminder", () => {
            let next: Reminder | null = null;
            db.transaction((transaction) => {
              transaction
                .update(reminders)
                .set({ completedAt: now, updatedAt: now })
                .where(eq(reminders.id, id))
                .run();
              const occurrence = nextReminderOccurrence(existing);
              if (occurrence !== null) {
                const nextId = createId(ReminderIdSchema);
                transaction
                  .insert(reminders)
                  .values({ id: nextId, ...occurrence, createdAt: now, updatedAt: now })
                  .run();
                next = toReminder(
                  required(
                    transaction.select().from(reminders).where(eq(reminders.id, nextId)).get(),
                  ),
                );
              }
            });
            const completed = toReminder(
              required(db.select().from(reminders).where(eq(reminders.id, id)).get()),
            );
            return { completed, next };
          }),
        ),
      ),
    attachDocument: (input: AttachDocumentInput, now) =>
      findVehicle(input.vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("attach document", () => {
            const id = createId(DocumentIdSchema);
            db.insert(documents)
              .values({ id, ...input, createdAt: now })
              .run();
            return toDocument(
              required(db.select().from(documents).where(eq(documents.id, id)).get()),
            );
          }),
        ),
      ),
    listDocuments: (vehicleId, page) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap(() =>
          databaseEffect("list documents", () =>
            db
              .select()
              .from(documents)
              .where(eq(documents.vehicleId, vehicleId))
              .orderBy(desc(documents.recordedAt), asc(documents.id))
              .limit(page.limit)
              .offset(page.offset)
              .all()
              .map(toDocument),
          ),
        ),
      ),
    removeDocument: (id) =>
      databaseEffect("get document", () =>
        db.select().from(documents).where(eq(documents.id, id)).get(),
      ).pipe(
        Effect.flatMap((row) =>
          row === undefined
            ? Effect.fail(new DocumentNotFound({ documentId: id }))
            : databaseEffect("remove document", () => {
                db.delete(documents).where(eq(documents.id, id)).run();
              }),
        ),
      ),
    getVehicleSummary: (vehicleId, now) =>
      findVehicle(vehicleId).pipe(
        Effect.flatMap((vehicle) =>
          Effect.all({
            currentMileageKm: currentMileage(vehicleId),
            maintenance: databaseEffect("summary maintenance", () =>
              db
                .select()
                .from(maintenanceEvents)
                .where(eq(maintenanceEvents.vehicleId, vehicleId))
                .orderBy(
                  desc(maintenanceEvents.performedAt),
                  desc(maintenanceEvents.createdAt),
                  desc(maintenanceEvents.id),
                )
                .all()
                .map((row) => toMaintenance(row, loadParts(row.id))),
            ),
            vehicleExpenses: databaseEffect("summary expenses", () =>
              db
                .select()
                .from(expenses)
                .where(eq(expenses.vehicleId, vehicleId))
                .all()
                .map(toExpense),
            ),
            vehicleReminders: databaseEffect("summary reminders", () =>
              db
                .select()
                .from(reminders)
                .where(eq(reminders.vehicleId, vehicleId))
                .all()
                .map(toReminder),
            ),
          }).pipe(
            Effect.map(({ currentMileageKm, maintenance, vehicleExpenses, vehicleReminders }) => {
              const totalExpensesCents = vehicleExpenses.reduce(
                (total, expense) => total + expense.amountCents,
                0,
              );
              const totalMaintenanceCents = maintenance.reduce(
                (total, event) => total + event.totalCostCents,
                0,
              );
              const totalRecordedCostCents = totalExpensesCents + totalMaintenanceCents;
              const first = maintenance[0];
              return {
                vehicle,
                currentMileageKm,
                lastMaintenance:
                  first === undefined
                    ? null
                    : { performedAt: first.performedAt, mileageKm: first.mileageKm },
                recentMaintenance: maintenance.slice(0, 5),
                reminders: vehicleReminders
                  .map((reminder) => ({
                    ...reminder,
                    status: reminderStatus(reminder, currentMileageKm, now),
                  }))
                  .filter(({ status }) => status === "due" || status === "overdue"),
                totalExpensesCents,
                totalMaintenanceCents,
                totalRecordedCostCents,
                costPerKmCents: costPerKm(
                  totalRecordedCostCents,
                  currentMileageKm,
                  vehicle.initialMileageKm,
                ),
                costByCategory: aggregateCosts(maintenance, vehicleExpenses),
              } satisfies VehicleSummary;
            }),
          ),
        ),
      ),
  };
};

export const SqliteGarageRepositoryLayer = Layer.effect(
  GarageRepository,
  Effect.gen(function* () {
    const { db } = yield* SqliteConnection;
    return makeRepository(db);
  }),
);

export const sqliteRepositoryLayer = (dbPath: string) =>
  SqliteGarageRepositoryLayer.pipe(Layer.provide(sqliteConnectionLayer(dbPath)));

export const migrateDatabase = (dbPath: string): void => {
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");
    migrate(drizzle(sqlite), { migrationsFolder });
  } finally {
    sqlite.close();
  }
};
