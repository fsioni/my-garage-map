import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GarageRepository } from "../../src/application/ports.js";
import type { DatabaseError } from "../../src/domain/errors.js";
import {
  createId,
  DocumentIdSchema,
  ExpenseIdSchema,
  MaintenanceEventIdSchema,
  ReminderIdSchema,
  VehicleIdSchema,
} from "../../src/domain/models.js";
import {
  migrateDatabase,
  SqliteConnection,
  sqliteConnectionLayer,
  SqliteGarageRepositoryLayer,
} from "../../src/infrastructure/database/sqlite.js";

type Runtime = ManagedRuntime.ManagedRuntime<GarageRepository | SqliteConnection, DatabaseError>;

const now = "2026-06-15T12:00:00.000Z";
const page = { limit: 50, offset: 0 };
let runtime: Runtime;

const makeRuntime = (databasePath = ":memory:"): Runtime => {
  const connection = sqliteConnectionLayer(databasePath);
  return ManagedRuntime.make(
    Layer.merge(connection, SqliteGarageRepositoryLayer.pipe(Layer.provide(connection))),
  );
};

const program = <A, E>(
  use: (
    repository: GarageRepository["Type"],
    connection: SqliteConnection["Type"],
  ) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const repository = yield* GarageRepository;
    const connection = yield* SqliteConnection;
    return yield* use(repository, connection);
  });

const createVehicle = (
  repository: GarageRepository["Type"],
  overrides: Partial<Parameters<GarageRepository["Type"]["createVehicle"]>[0]> = {},
) =>
  repository.createVehicle(
    {
      name: "Daily",
      make: "Peugeot",
      model: "2008",
      initialMileageKm: 100_000,
      ...overrides,
    },
    now,
  );

beforeEach(() => {
  runtime = makeRuntime();
});

afterEach(async () => {
  await runtime.dispose();
});

describe("SQLite migrations and constraints", () => {
  it("creates every expected application table", async () => {
    const names = await runtime.runPromise(
      program((_repository, { sqlite }) =>
        Effect.sync(() =>
          sqlite
            .prepare(
              "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name",
            )
            .all()
            .map((row) =>
              typeof row === "object" && row !== null && "name" in row ? row.name : "",
            ),
        ),
      ),
    );
    expect(names).toEqual([
      "__drizzle_migrations",
      "documents",
      "expenses",
      "maintenance_events",
      "mileage_records",
      "parts",
      "reminders",
      "vehicles",
    ]);
  });

  it("creates every required search index", async () => {
    const names = await runtime.runPromise(
      program((_repository, { sqlite }) =>
        Effect.sync(() =>
          sqlite
            .prepare(
              "select name from sqlite_master where type = 'index' and name not like 'sqlite_%'",
            )
            .all()
            .flatMap((row) =>
              typeof row === "object" &&
              row !== null &&
              "name" in row &&
              typeof row.name === "string"
                ? [row.name]
                : [],
            ),
        ),
      ),
    );
    expect(names).toEqual(
      expect.arrayContaining([
        "mileage_records_vehicle_recorded_idx",
        "maintenance_vehicle_performed_idx",
        "expenses_vehicle_incurred_idx",
        "reminders_vehicle_idx",
        "documents_vehicle_idx",
        "parts_maintenance_idx",
      ]),
    );
  });

  it("enables foreign keys on every connection", async () => {
    const enabled = await runtime.runPromise(
      program((_repository, { sqlite }) =>
        Effect.sync(() => sqlite.pragma("foreign_keys", { simple: true })),
      ),
    );
    expect(enabled).toBe(1);
  });

  it("rejects a mileage row whose vehicle does not exist", async () => {
    const result = await runtime.runPromise(
      program((_repository, { sqlite }) =>
        Effect.sync(() => {
          expect(() =>
            sqlite
              .prepare(
                "insert into mileage_records (id, vehicle_id, mileage_km, recorded_at, source, created_at) values (?, ?, ?, ?, ?, ?)",
              )
              .run(crypto.randomUUID(), crypto.randomUUID(), 1, "2026-01-01", "manual", now),
          ).toThrow();
          return true;
        }),
      ),
    );
    expect(result).toBe(true);
  });

  it("rejects duplicate non-null VIN values", async () => {
    const outcome = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          yield* createVehicle(repository, { vin: "VF3UNIQUE" });
          return yield* Effect.either(
            createVehicle(repository, {
              name: "Second",
              vin: "VF3UNIQUE",
            }),
          );
        }),
      ),
    );
    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { _tag: "DatabaseError" },
    });
  });

  it("rejects duplicate non-null registration numbers", async () => {
    const outcome = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          yield* createVehicle(repository, { registrationNumber: "AA-123-AA" });
          return yield* Effect.either(
            createVehicle(repository, {
              name: "Second",
              registrationNumber: "AA-123-AA",
            }),
          );
        }),
      ),
    );
    expect(outcome._tag).toBe("Left");
  });

  it.each([
    ["negative initial mileage", { initialMileageKm: -1 }],
    ["negative purchase price", { purchasePriceCents: -1 }],
    ["empty name", { name: " " }],
    ["empty make", { make: " " }],
    ["empty model", { model: " " }],
  ])("enforces vehicle SQL constraint: %s", async (_label, overrides) => {
    const outcome = await runtime.runPromise(
      program((repository) => Effect.either(createVehicle(repository, overrides))),
    );
    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { _tag: "DatabaseError" },
    });
  });

  it("applies migrations idempotently to a file database", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "garage-mcp-migrate-"));
    const databasePath = path.join(directory, "garage.sqlite");
    try {
      expect(() => migrateDatabase(databasePath)).not.toThrow();
      expect(() => migrateDatabase(databasePath)).not.toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("SQLite vehicles and mileage", () => {
  it("round-trips all vehicle fields", async () => {
    const vehicle = await runtime.runPromise(
      program((repository) =>
        createVehicle(repository, {
          registrationNumber: "AA-123-AA",
          vin: "VF3TEST",
          firstRegistrationDate: "2013-01-01",
          purchaseDate: "2026-01-01",
          purchasePriceCents: 1_000_000,
          currency: "USD",
          notes: "Complete",
        }),
      ),
    );
    const loaded = await runtime.runPromise(
      program((repository) => repository.getVehicle(vehicle.id)),
    );
    expect(loaded).toEqual(vehicle);
  });

  it("sorts and paginates vehicles deterministically", async () => {
    const names = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          yield* createVehicle(repository, { name: "Zulu" });
          yield* createVehicle(repository, { name: "Alpha" });
          yield* createVehicle(repository, { name: "Mike" });
          const records = yield* repository.listVehicles({
            limit: 1,
            offset: 1,
          });
          return records.map(({ name }) => name);
        }),
      ),
    );
    expect(names).toEqual(["Mike"]);
  });

  it("clears nullable vehicle fields in SQLite", async () => {
    const updated = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository, {
            registrationNumber: "AA",
            vin: "VIN",
            firstRegistrationDate: "2013-01-01",
            purchaseDate: "2026-01-01",
            purchasePriceCents: 100,
            notes: "Note",
          });
          return yield* repository.updateVehicle(
            vehicle.id,
            {
              registrationNumber: null,
              vin: null,
              firstRegistrationDate: null,
              purchaseDate: null,
              purchasePriceCents: null,
              notes: null,
            },
            now,
          );
        }),
      ),
    );
    expect(updated.registrationNumber).toBeUndefined();
    expect(updated.vin).toBeUndefined();
    expect(updated.firstRegistrationDate).toBeUndefined();
    expect(updated.purchaseDate).toBeUndefined();
    expect(updated.purchasePriceCents).toBeUndefined();
    expect(updated.notes).toBeUndefined();
  });

  it("accepts equal mileage when date differs", async () => {
    const records = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          yield* repository.recordMileage(
            {
              vehicleId: vehicle.id,
              mileageKm: 100_000,
              recordedAt: "2026-01-01",
              source: "manual",
            },
            now,
          );
          yield* repository.recordMileage(
            {
              vehicleId: vehicle.id,
              mileageKm: 100_000,
              recordedAt: "2026-01-02",
              source: "manual",
            },
            now,
          );
          return yield* repository.listMileageRecords(vehicle.id, page);
        }),
      ),
    );
    expect(records).toHaveLength(2);
  });

  it("accepts equal mileage when source differs", async () => {
    const records = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          for (const source of ["manual", "import"] as const) {
            yield* repository.recordMileage(
              {
                vehicleId: vehicle.id,
                mileageKm: 100_000,
                recordedAt: "2026-01-01",
                source,
              },
              now,
            );
          }
          return yield* repository.listMileageRecords(vehicle.id, page);
        }),
      ),
    );
    expect(records.map(({ source }) => source).toSorted()).toEqual(["import", "manual"]);
  });

  it("rejects a fully duplicate mileage record", async () => {
    const outcome = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const input = {
            vehicleId: vehicle.id,
            mileageKm: 100_000,
            recordedAt: "2026-01-01",
            source: "manual" as const,
          };
          yield* repository.recordMileage(input, now);
          return yield* Effect.either(repository.recordMileage(input, now));
        }),
      ),
    );
    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { _tag: "InvalidMileage" },
    });
  });

  it("uses creation time as tie-breaker for current mileage", async () => {
    const current = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          yield* repository.recordMileage(
            {
              vehicleId: vehicle.id,
              mileageKm: 101_000,
              recordedAt: "2026-06-01",
              source: "manual",
            },
            "2026-06-01T00:00:00.000Z",
          );
          yield* repository.recordMileage(
            {
              vehicleId: vehicle.id,
              mileageKm: 102_000,
              recordedAt: "2026-06-01",
              source: "import",
            },
            "2026-06-02T00:00:00.000Z",
          );
          return yield* repository.getCurrentMileage(vehicle.id);
        }),
      ),
    );
    expect(current).toBe(102_000);
  });

  it("keeps different vehicles isolated", async () => {
    const values = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const first = yield* createVehicle(repository, { name: "First" });
          const second = yield* createVehicle(repository, {
            name: "Second",
            initialMileageKm: 200_000,
          });
          yield* repository.recordMileage(
            {
              vehicleId: first.id,
              mileageKm: 110_000,
              recordedAt: "2026-01-01",
              source: "manual",
            },
            now,
          );
          return [
            yield* repository.getCurrentMileage(first.id),
            yield* repository.getCurrentMileage(second.id),
          ];
        }),
      ),
    );
    expect(values).toEqual([110_000, 200_000]);
  });
});

describe("SQLite maintenance transactions", () => {
  it("persists maintenance, parts, and mileage in one success transaction", async () => {
    const result = await runtime.runPromise(
      program((repository, { sqlite }) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const maintenance = yield* repository.addMaintenance(
            {
              vehicleId: vehicle.id,
              title: "Brakes",
              category: "brakes",
              performedAt: "2026-06-01",
              mileageKm: 101_000,
              laborCostCents: 5_000,
              parts: [
                { name: "Pads", quantity: 2, unitPriceCents: 3_000 },
                { name: "Fluid", quantity: 1, unitPriceCents: 1_000 },
              ],
            },
            now,
          );
          return {
            maintenance,
            partCount: sqlite.prepare("select count(*) as total from parts").get(),
            mileageCount: sqlite.prepare("select count(*) as total from mileage_records").get(),
          };
        }),
      ),
    );
    expect(result.maintenance.totalCostCents).toBe(12_000);
    expect(result.partCount).toEqual({ total: 2 });
    expect(result.mileageCount).toEqual({ total: 1 });
  });

  it("rolls back maintenance, parts, and mileage when a part violates a constraint", async () => {
    const counts = await runtime.runPromise(
      program((repository, { sqlite }) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const outcome = yield* Effect.either(
            repository.addMaintenance(
              {
                vehicleId: vehicle.id,
                title: "Invalid",
                category: "other",
                performedAt: "2026-06-01",
                mileageKm: 101_000,
                laborCostCents: 0,
                parts: [{ name: "Bad", quantity: 0, unitPriceCents: 100 }],
              },
              now,
            ),
          );
          return {
            outcome,
            maintenance: sqlite.prepare("select count(*) as total from maintenance_events").get(),
            parts: sqlite.prepare("select count(*) as total from parts").get(),
            mileage: sqlite.prepare("select count(*) as total from mileage_records").get(),
          };
        }),
      ),
    );
    expect(counts.outcome._tag).toBe("Left");
    expect(counts.maintenance).toEqual({ total: 0 });
    expect(counts.parts).toEqual({ total: 0 });
    expect(counts.mileage).toEqual({ total: 0 });
  });

  it("replaces parts atomically during maintenance update", async () => {
    const updated = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const created = yield* repository.addMaintenance(
            {
              vehicleId: vehicle.id,
              title: "Service",
              category: "other",
              performedAt: "2026-06-01",
              mileageKm: 100_000,
              laborCostCents: 100,
              parts: [
                { name: "Old A", quantity: 1, unitPriceCents: 100 },
                { name: "Old B", quantity: 1, unitPriceCents: 100 },
              ],
            },
            now,
          );
          return yield* repository.updateMaintenance(
            created.id,
            {
              laborCostCents: 200,
              parts: [{ name: "New", quantity: 2, unitPriceCents: 300 }],
            },
            now,
          );
        }),
      ),
    );
    expect(updated.parts.map(({ name }) => name)).toEqual(["New"]);
    expect(updated.partsCostCents).toBe(600);
    expect(updated.totalCostCents).toBe(800);
  });

  it("rolls back an invalid parts replacement and keeps old parts", async () => {
    const result = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const created = yield* repository.addMaintenance(
            {
              vehicleId: vehicle.id,
              title: "Service",
              category: "other",
              performedAt: "2026-06-01",
              mileageKm: 100_000,
              laborCostCents: 100,
              parts: [{ name: "Original", quantity: 1, unitPriceCents: 100 }],
            },
            now,
          );
          const outcome = yield* Effect.either(
            repository.updateMaintenance(
              created.id,
              {
                parts: [{ name: "Invalid", quantity: 0, unitPriceCents: 100 }],
              },
              now,
            ),
          );
          return {
            outcome,
            persisted: yield* repository.getMaintenance(created.id),
          };
        }),
      ),
    );
    expect(result.outcome._tag).toBe("Left");
    expect(result.persisted.parts.map(({ name }) => name)).toEqual(["Original"]);
    expect(result.persisted.totalCostCents).toBe(200);
  });

  it("deletes owned parts but retains and detaches document metadata", async () => {
    const result = await runtime.runPromise(
      program((repository, { sqlite }) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const maintenance = yield* repository.addMaintenance(
            {
              vehicleId: vehicle.id,
              title: "Service",
              category: "other",
              performedAt: "2026-06-01",
              mileageKm: 100_000,
              laborCostCents: 0,
              parts: [{ name: "Part", quantity: 1, unitPriceCents: 100 }],
            },
            now,
          );
          yield* repository.attachDocument(
            {
              vehicleId: vehicle.id,
              maintenanceEventId: maintenance.id,
              type: "invoice",
              title: "Invoice",
              localPath: "/tmp/invoice.pdf",
              recordedAt: "2026-06-01",
            },
            now,
          );
          yield* repository.deleteMaintenance(maintenance.id);
          return {
            partCount: sqlite.prepare("select count(*) as total from parts").get(),
            documents: yield* repository.listDocuments(vehicle.id, page),
          };
        }),
      ),
    );
    expect(result.partCount).toEqual({ total: 0 });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.maintenanceEventId).toBeUndefined();
  });
});

describe("SQLite expenses, reminders, documents, and summaries", () => {
  it("round-trips and clears every optional expense field", async () => {
    const updated = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const expense = yield* repository.addExpense(
            {
              vehicleId: vehicle.id,
              category: "fuel",
              description: "Fuel",
              amountCents: 7_500,
              incurredAt: "2026-06-01",
              mileageKm: 100_500,
              vendor: "Station",
              notes: "Full",
            },
            now,
          );
          return yield* repository.updateExpense(
            expense.id,
            { mileageKm: null, vendor: null, notes: null },
            now,
          );
        }),
      ),
    );
    expect(updated.mileageKm).toBeUndefined();
    expect(updated.vendor).toBeUndefined();
    expect(updated.notes).toBeUndefined();
  });

  it("sorts and paginates expenses newest first", async () => {
    const records = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          for (const [description, incurredAt] of [
            ["One", "2026-01-01"],
            ["Two", "2026-02-01"],
            ["Three", "2026-03-01"],
          ] as const) {
            yield* repository.addExpense(
              {
                vehicleId: vehicle.id,
                category: "other",
                description,
                amountCents: 100,
                incurredAt,
              },
              now,
            );
          }
          return yield* repository.listExpenses(vehicle.id, {
            limit: 1,
            offset: 1,
          });
        }),
      ),
    );
    expect(records.map(({ description }) => description)).toEqual(["Two"]);
  });

  it("completes a non-recurring reminder without creating another row", async () => {
    const result = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const reminder = yield* repository.addReminder(
            {
              vehicleId: vehicle.id,
              title: "Inspection",
              category: "inspection",
              dueDate: "2026-06-30",
            },
            now,
          );
          const completion = yield* repository.completeReminder(reminder.id, now);
          return {
            completion,
            records: yield* repository.listReminders(vehicle.id, page),
          };
        }),
      ),
    );
    expect(result.completion.next).toBeNull();
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.completedAt).toBe(now);
  });

  it("atomically completes and creates a recurring reminder", async () => {
    const result = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const reminder = yield* repository.addReminder(
            {
              vehicleId: vehicle.id,
              title: "Oil",
              category: "engine_oil",
              dueDate: "2026-06-30",
              dueMileageKm: 110_000,
              recurrenceMonths: 12,
              recurrenceKm: 10_000,
            },
            now,
          );
          const completion = yield* repository.completeReminder(reminder.id, now);
          return {
            completion,
            records: yield* repository.listReminders(vehicle.id, page),
          };
        }),
      ),
    );
    expect(result.completion.completed.completedAt).toBe(now);
    expect(result.completion.next).toMatchObject({
      dueDate: "2027-06-30",
      dueMileageKm: 120_000,
    });
    expect(result.records).toHaveLength(2);
  });

  it("persists a document associated with an expense", async () => {
    const document = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const expense = yield* repository.addExpense(
            {
              vehicleId: vehicle.id,
              category: "fuel",
              description: "Fuel",
              amountCents: 100,
              incurredAt: "2026-01-01",
            },
            now,
          );
          const attached = yield* repository.attachDocument(
            {
              vehicleId: vehicle.id,
              expenseId: expense.id,
              type: "receipt",
              title: "Receipt",
              localPath: "/tmp/receipt.pdf",
              mimeType: "application/pdf",
              recordedAt: "2026-01-01",
              notes: "Original",
            },
            now,
          );
          return (yield* repository.listDocuments(vehicle.id, page))[0] ?? attached;
        }),
      ),
    );
    expect(document).toMatchObject({
      type: "receipt",
      title: "Receipt",
      localPath: "/tmp/receipt.pdf",
      mimeType: "application/pdf",
      notes: "Original",
    });
    expect(document.expenseId).toBeDefined();
  });

  it("detaches an expense document when deleting the expense", async () => {
    const documents = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          const expense = yield* repository.addExpense(
            {
              vehicleId: vehicle.id,
              category: "other",
              description: "Expense",
              amountCents: 100,
              incurredAt: "2026-01-01",
            },
            now,
          );
          yield* repository.attachDocument(
            {
              vehicleId: vehicle.id,
              expenseId: expense.id,
              type: "receipt",
              title: "Receipt",
              localPath: "/tmp/receipt.pdf",
              recordedAt: "2026-01-01",
            },
            now,
          );
          yield* repository.deleteExpense(expense.id);
          return yield* repository.listDocuments(vehicle.id, page);
        }),
      ),
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]?.expenseId).toBeUndefined();
  });

  it("computes a summary without double-counting maintenance", async () => {
    const summary = await runtime.runPromise(
      program((repository) =>
        Effect.gen(function* () {
          const vehicle = yield* createVehicle(repository);
          yield* repository.addMaintenance(
            {
              vehicleId: vehicle.id,
              title: "Oil",
              category: "engine_oil",
              performedAt: "2026-06-01",
              mileageKm: 101_000,
              laborCostCents: 5_000,
              parts: [{ name: "Oil", quantity: 1, unitPriceCents: 4_000 }],
            },
            now,
          );
          yield* repository.addExpense(
            {
              vehicleId: vehicle.id,
              category: "fuel",
              description: "Fuel",
              amountCents: 7_500,
              incurredAt: "2026-06-01",
            },
            now,
          );
          return yield* repository.getVehicleSummary(vehicle.id, now);
        }),
      ),
    );
    expect(summary.totalMaintenanceCents).toBe(9_000);
    expect(summary.totalExpensesCents).toBe(7_500);
    expect(summary.totalRecordedCostCents).toBe(16_500);
    expect(summary.costByCategory).toEqual({
      "expense:fuel": 7_500,
      "maintenance:engine_oil": 9_000,
    });
  });

  it.each(["vehicle", "maintenance", "expense", "reminder", "document"] as const)(
    "maps missing %s records to a typed error",
    async (kind) => {
      const outcome = await runtime.runPromise(
        program((repository) => {
          switch (kind) {
            case "vehicle":
              return Effect.either(
                repository.getVehicle(createId(VehicleIdSchema)).pipe(Effect.asVoid),
              );
            case "maintenance":
              return Effect.either(
                repository.getMaintenance(createId(MaintenanceEventIdSchema)).pipe(Effect.asVoid),
              );
            case "expense":
              return Effect.either(
                repository.updateExpense(createId(ExpenseIdSchema), {}, now).pipe(Effect.asVoid),
              );
            case "reminder":
              return Effect.either(
                repository.completeReminder(createId(ReminderIdSchema), now).pipe(Effect.asVoid),
              );
            case "document":
              return Effect.either(
                repository.removeDocument(createId(DocumentIdSchema)).pipe(Effect.asVoid),
              );
          }
        }),
      );
      expect(outcome._tag).toBe("Left");
    },
  );
});
