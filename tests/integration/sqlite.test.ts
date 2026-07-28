import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { GarageRepository } from "../../src/application/ports.js";
import type { DatabaseError } from "../../src/domain/errors.js";
import { createId, DocumentIdSchema } from "../../src/domain/models.js";
import {
  SqliteConnection,
  sqliteConnectionLayer,
  SqliteGarageRepositoryLayer,
} from "../../src/infrastructure/database/sqlite.js";

const runtimes: ManagedRuntime.ManagedRuntime<
  GarageRepository | SqliteConnection,
  DatabaseError
>[] = [];

const makeRuntime = () => {
  const connection = sqliteConnectionLayer(":memory:");
  const layer = Layer.merge(
    connection,
    SqliteGarageRepositoryLayer.pipe(Layer.provide(connection)),
  );
  const runtime = ManagedRuntime.make(layer);
  runtimes.push(runtime);
  return runtime;
};

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
});

describe("SQLite adapter", () => {
  it("applies migrations, enforces transactions, and persists every aggregate", async () => {
    const runtime = makeRuntime();
    const now = "2026-06-01T10:00:00.000Z";
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        const connection = yield* SqliteConnection;
        const tables = connection.sqlite
          .prepare("select name from sqlite_master where type = 'table'")
          .all()
          .map((row) => (typeof row === "object" && row !== null && "name" in row ? row.name : ""));
        const vehicle = yield* repository.createVehicle(
          {
            name: "Daily",
            make: "Peugeot",
            model: "2008",
            vin: "VF3TEST",
            purchasePriceCents: 1_000_000,
            initialMileageKm: 100_000,
          },
          now,
        );
        const updatedVehicle = yield* repository.updateVehicle(
          vehicle.id,
          { notes: "Reliable", registrationNumber: "AB-123-CD" },
          now,
        );
        const mileage = yield* repository.recordMileage(
          {
            vehicleId: vehicle.id,
            mileageKm: 101_000,
            recordedAt: "2026-05-01",
            source: "manual",
          },
          now,
        );
        const maintenance = yield* repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title: "Oil service",
            category: "engine_oil",
            performedAt: "2026-05-20",
            mileageKm: 102_000,
            laborCostCents: 5_000,
            parts: [{ name: "Oil", quantity: 1, unitPriceCents: 4_000 }],
          },
          now,
        );
        const updatedMaintenance = yield* repository.updateMaintenance(
          maintenance.id,
          {
            workshop: "Local garage",
            parts: [{ name: "Oil 5W30", quantity: 2, unitPriceCents: 2_500 }],
          },
          now,
        );
        const expense = yield* repository.addExpense(
          {
            vehicleId: vehicle.id,
            category: "fuel",
            description: "Fuel",
            amountCents: 7_500,
            incurredAt: "2026-05-22",
          },
          now,
        );
        const updatedExpense = yield* repository.updateExpense(
          expense.id,
          { vendor: "Station", amountCents: 8_000 },
          now,
        );
        const reminder = yield* repository.addReminder(
          {
            vehicleId: vehicle.id,
            title: "Next oil",
            category: "engine_oil",
            dueDate: "2027-05-20",
            dueMileageKm: 112_000,
            recurrenceMonths: 12,
            recurrenceKm: 10_000,
          },
          now,
        );
        const completion = yield* repository.completeReminder(reminder.id, now);
        const document = yield* repository.attachDocument(
          {
            vehicleId: vehicle.id,
            maintenanceEventId: maintenance.id,
            type: "invoice",
            title: "Oil invoice",
            localPath: "/tmp/invoice.pdf",
            recordedAt: "2026-05-20",
          },
          now,
        );
        const summary = yield* repository.getVehicleSummary(vehicle.id, now);
        return {
          tables,
          vehicle,
          updatedVehicle,
          mileage,
          maintenance,
          updatedMaintenance,
          updatedExpense,
          completion,
          document,
          summary,
          vehicles: yield* repository.listVehicles({ limit: 50, offset: 0 }),
          mileageRecords: yield* repository.listMileageRecords(vehicle.id, {
            limit: 50,
            offset: 0,
          }),
          maintenanceRecords: yield* repository.listMaintenance(vehicle.id, {
            limit: 50,
            offset: 0,
          }),
          expenses: yield* repository.listExpenses(vehicle.id, { limit: 50, offset: 0 }),
          reminders: yield* repository.listReminders(vehicle.id, { limit: 50, offset: 0 }),
          documents: yield* repository.listDocuments(vehicle.id, { limit: 50, offset: 0 }),
          currentMileage: yield* repository.getCurrentMileage(vehicle.id),
        };
      }),
    );
    expect(result.tables).toContain("vehicles");
    expect(result.updatedVehicle.vin).toBe("VF3TEST");
    expect(result.currentMileage).toBe(102_000);
    expect(result.mileage.mileageKm).toBe(101_000);
    expect(result.updatedMaintenance.totalCostCents).toBe(10_000);
    expect(result.updatedExpense.amountCents).toBe(8_000);
    expect(result.completion.next).toMatchObject({
      dueDate: "2028-05-20",
      dueMileageKm: 122_000,
    });
    expect(result.documents).toHaveLength(1);
    expect(result.summary.totalExpensesCents).toBe(8_000);
    expect(result.summary.totalMaintenanceCents).toBe(10_000);
    expect(result.summary.totalRecordedCostCents).toBe(18_000);
    expect(result.vehicles).toHaveLength(1);
    expect(result.mileageRecords).toHaveLength(2);
    expect(result.maintenanceRecords).toHaveLength(1);
    expect(result.expenses).toHaveLength(1);
    expect(result.reminders).toHaveLength(2);
  });

  it("rejects regressions, rolls back failed maintenance, and reports missing records", async () => {
    const runtime = makeRuntime();
    const now = "2026-06-01T10:00:00.000Z";
    const vehicle = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        return yield* repository.createVehicle(
          { name: "Car", make: "Make", model: "Model", initialMileageKm: 1_000 },
          now,
        );
      }),
    );
    const regression = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        return yield* repository.recordMileage(
          {
            vehicleId: vehicle.id,
            mileageKm: 999,
            recordedAt: "2026-01-01",
            source: "manual",
          },
          now,
        );
      }).pipe(Effect.flip),
    );
    expect(regression).toMatchObject({ _tag: "MileageRegression" });

    const failed = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        return yield* repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title: "Invalid transaction",
            category: "other",
            performedAt: "2026-01-01",
            mileageKm: 1_100,
            laborCostCents: 0,
            parts: [{ name: "Bad", quantity: 0, unitPriceCents: 10 }],
          },
          now,
        );
      }).pipe(Effect.flip),
    );
    expect(failed).toMatchObject({ _tag: "DatabaseError" });
    const counts = await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        const connection = yield* SqliteConnection;
        const eventCount = connection.sqlite
          .prepare("select count(*) as total from maintenance_events")
          .get();
        const mileageCount = connection.sqlite
          .prepare("select count(*) as total from mileage_records")
          .get();
        expect(() =>
          connection.sqlite
            .prepare(
              "insert into mileage_records (id, vehicle_id, mileage_km, recorded_at, source, created_at) values (?, ?, ?, ?, ?, ?)",
            )
            .run(crypto.randomUUID(), crypto.randomUUID(), 1, "2026-01-01", "manual", now),
        ).toThrow();
        yield* repository.removeDocument(createId(DocumentIdSchema)).pipe(Effect.flip);
        return { eventCount, mileageCount };
      }),
    );
    expect(counts.eventCount).toEqual({ total: 0 });
    expect(counts.mileageCount).toEqual({ total: 0 });
  });

  it("explicitly detaches documents when deleting parent records", async () => {
    const runtime = makeRuntime();
    const now = "2026-06-01T10:00:00.000Z";
    await runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* GarageRepository;
        const vehicle = yield* repository.createVehicle(
          { name: "Car", make: "Make", model: "Model", initialMileageKm: 1_000 },
          now,
        );
        const maintenance = yield* repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title: "Service",
            category: "other",
            performedAt: "2026-01-01",
            mileageKm: 1_000,
            laborCostCents: 0,
            parts: [],
          },
          now,
        );
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
            maintenanceEventId: maintenance.id,
            type: "invoice",
            title: "Maintenance",
            localPath: "/tmp/m.pdf",
            recordedAt: "2026-01-01",
          },
          now,
        );
        const expenseDocument = yield* repository.attachDocument(
          {
            vehicleId: vehicle.id,
            expenseId: expense.id,
            type: "receipt",
            title: "Expense",
            localPath: "/tmp/e.pdf",
            recordedAt: "2026-01-01",
          },
          now,
        );
        yield* repository.deleteMaintenance(maintenance.id);
        yield* repository.deleteExpense(expense.id);
        yield* repository.removeDocument(expenseDocument.id);
        const remaining = yield* repository.listDocuments(vehicle.id, { limit: 50, offset: 0 });
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.maintenanceEventId).toBeUndefined();
      }),
    );
  });
});
