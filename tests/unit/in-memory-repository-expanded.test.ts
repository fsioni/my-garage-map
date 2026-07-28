import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { GarageRepositoryService } from "../../src/application/ports.js";
import {
  createId,
  DocumentIdSchema,
  ExpenseIdSchema,
  MaintenanceEventIdSchema,
  ReminderIdSchema,
  VehicleIdSchema,
} from "../../src/domain/models.js";
import { makeInMemoryGarageRepository } from "../../src/infrastructure/database/in-memory-repository.js";

const now = "2026-06-15T12:00:00.000Z";
const page = { limit: 50, offset: 0 };

const createVehicle = (
  repository: GarageRepositoryService,
  overrides: Partial<Parameters<GarageRepositoryService["createVehicle"]>[0]> = {},
) =>
  Effect.runPromise(
    repository.createVehicle(
      {
        name: "Daily",
        make: "Peugeot",
        model: "2008",
        initialMileageKm: 100_000,
        ...overrides,
      },
      now,
    ),
  );

const left = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.either(effect));

describe("in-memory vehicle repository", () => {
  it("creates a vehicle with defaults and timestamps", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    expect(vehicle).toMatchObject({
      name: "Daily",
      make: "Peugeot",
      model: "2008",
      currency: "EUR",
      initialMileageKm: 100_000,
      createdAt: now,
      updatedAt: now,
    });
    expect(vehicle.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves every optional vehicle field", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository, {
      registrationNumber: "AA-123-AA",
      vin: "VF3TEST",
      firstRegistrationDate: "2013-01-01",
      purchaseDate: "2026-01-01",
      purchasePriceCents: 1_000_000,
      currency: "USD",
      notes: "Imported",
    });
    expect(vehicle).toMatchObject({
      registrationNumber: "AA-123-AA",
      vin: "VF3TEST",
      firstRegistrationDate: "2013-01-01",
      purchaseDate: "2026-01-01",
      purchasePriceCents: 1_000_000,
      currency: "USD",
      notes: "Imported",
    });
  });

  it("sorts vehicles by name then id", async () => {
    const repository = makeInMemoryGarageRepository();
    await createVehicle(repository, { name: "Zulu" });
    await createVehicle(repository, { name: "Alpha" });
    await createVehicle(repository, { name: "Mike" });
    const vehicles = await Effect.runPromise(repository.listVehicles(page));
    expect(vehicles.map(({ name }) => name)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("paginates vehicles", async () => {
    const repository = makeInMemoryGarageRepository();
    await createVehicle(repository, { name: "Alpha" });
    await createVehicle(repository, { name: "Bravo" });
    await createVehicle(repository, { name: "Charlie" });
    const vehicles = await Effect.runPromise(repository.listVehicles({ limit: 1, offset: 1 }));
    expect(vehicles.map(({ name }) => name)).toEqual(["Bravo"]);
  });

  it("gets an existing vehicle", async () => {
    const repository = makeInMemoryGarageRepository();
    const created = await createVehicle(repository);
    await expect(Effect.runPromise(repository.getVehicle(created.id))).resolves.toEqual(created);
  });

  it("returns VehicleNotFound for a missing vehicle", async () => {
    const repository = makeInMemoryGarageRepository();
    expect(await left(repository.getVehicle(createId(VehicleIdSchema)))).toMatchObject({
      _tag: "Left",
      left: { _tag: "VehicleNotFound" },
    });
  });

  it("updates mutable vehicle fields", async () => {
    const repository = makeInMemoryGarageRepository();
    const created = await createVehicle(repository);
    const updated = await Effect.runPromise(
      repository.updateVehicle(
        created.id,
        {
          name: "Weekend",
          make: "Citroën",
          model: "C3",
          registrationNumber: "BB-456-BB",
          vin: "VF7TEST",
          firstRegistrationDate: "2020-01-01",
          purchaseDate: "2025-01-01",
          purchasePriceCents: 900_000,
          currency: "GBP",
          notes: "Updated",
        },
        "2026-06-16T00:00:00.000Z",
      ),
    );
    expect(updated).toMatchObject({
      name: "Weekend",
      make: "Citroën",
      model: "C3",
      registrationNumber: "BB-456-BB",
      vin: "VF7TEST",
      purchasePriceCents: 900_000,
      currency: "GBP",
      notes: "Updated",
      updatedAt: "2026-06-16T00:00:00.000Z",
    });
  });

  it("clears all nullable vehicle fields", async () => {
    const repository = makeInMemoryGarageRepository();
    const created = await createVehicle(repository, {
      registrationNumber: "AA",
      vin: "VIN",
      firstRegistrationDate: "2013-01-01",
      purchaseDate: "2026-01-01",
      purchasePriceCents: 100,
      notes: "Note",
    });
    const updated = await Effect.runPromise(
      repository.updateVehicle(
        created.id,
        {
          registrationNumber: null,
          vin: null,
          firstRegistrationDate: null,
          purchaseDate: null,
          purchasePriceCents: null,
          notes: null,
        },
        now,
      ),
    );
    expect(updated.registrationNumber).toBeUndefined();
    expect(updated.vin).toBeUndefined();
    expect(updated.firstRegistrationDate).toBeUndefined();
    expect(updated.purchaseDate).toBeUndefined();
    expect(updated.purchasePriceCents).toBeUndefined();
    expect(updated.notes).toBeUndefined();
  });
});

describe("in-memory mileage repository", () => {
  it("uses initial mileage when there are no records", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    await expect(Effect.runPromise(repository.getCurrentMileage(vehicle.id))).resolves.toBe(
      100_000,
    );
  });

  it("records mileage with every field", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const record = await Effect.runPromise(
      repository.recordMileage(
        {
          vehicleId: vehicle.id,
          mileageKm: 101_000,
          recordedAt: "2026-06-01",
          source: "import",
          notes: "Imported record",
        },
        now,
      ),
    );
    expect(record).toMatchObject({
      vehicleId: vehicle.id,
      mileageKm: 101_000,
      recordedAt: "2026-06-01",
      source: "import",
      notes: "Imported record",
      createdAt: now,
    });
  });

  it("accepts equal mileage with a different source", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    await Effect.runPromise(
      repository.recordMileage(
        {
          vehicleId: vehicle.id,
          mileageKm: 100_000,
          recordedAt: "2026-01-01",
          source: "manual",
        },
        now,
      ),
    );
    await expect(
      Effect.runPromise(
        repository.recordMileage(
          {
            vehicleId: vehicle.id,
            mileageKm: 100_000,
            recordedAt: "2026-01-01",
            source: "import",
          },
          now,
        ),
      ),
    ).resolves.toMatchObject({ mileageKm: 100_000, source: "import" });
  });

  it("rejects a mileage regression", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    expect(
      await left(
        repository.recordMileage(
          {
            vehicleId: vehicle.id,
            mileageKm: 99_999,
            recordedAt: "2026-01-01",
            source: "manual",
          },
          now,
        ),
      ),
    ).toMatchObject({
      _tag: "Left",
      left: { _tag: "MileageRegression", attempted: 99_999, current: 100_000 },
    });
  });

  it("selects current mileage by recorded date, not insertion order", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    await Effect.runPromise(
      repository.recordMileage(
        {
          vehicleId: vehicle.id,
          mileageKm: 110_000,
          recordedAt: "2026-06-01",
          source: "manual",
        },
        now,
      ),
    );
    await Effect.runPromise(
      repository.recordMileage(
        {
          vehicleId: vehicle.id,
          mileageKm: 120_000,
          recordedAt: "2026-05-01",
          source: "import",
        },
        "2026-06-16T00:00:00.000Z",
      ),
    );
    await expect(Effect.runPromise(repository.getCurrentMileage(vehicle.id))).resolves.toBe(
      110_000,
    );
  });

  it("sorts and paginates mileage history", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (const [mileageKm, recordedAt] of [
      [101_000, "2026-01-01"],
      [102_000, "2026-02-01"],
      [103_000, "2026-03-01"],
    ] as const) {
      await Effect.runPromise(
        repository.recordMileage(
          { vehicleId: vehicle.id, mileageKm, recordedAt, source: "manual" },
          now,
        ),
      );
    }
    const records = await Effect.runPromise(
      repository.listMileageRecords(vehicle.id, { limit: 1, offset: 1 }),
    );
    expect(records.map(({ mileageKm }) => mileageKm)).toEqual([102_000]);
  });

  it("rejects an identical mileage record with InvalidMileage", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const input = {
      vehicleId: vehicle.id,
      mileageKm: 100_000,
      recordedAt: "2026-01-01",
      source: "manual" as const,
    };
    await Effect.runPromise(repository.recordMileage(input, now));
    const outcome = await Effect.runPromise(Effect.either(repository.recordMileage(input, now)));
    expect(outcome).toMatchObject({
      _tag: "Left",
      left: { _tag: "InvalidMileage" },
    });
  });
});

describe("in-memory maintenance repository", () => {
  it("calculates parts and total cost", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const maintenance = await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Brakes",
          category: "brakes",
          performedAt: "2026-06-01",
          mileageKm: 101_000,
          laborCostCents: 5_000,
          parts: [
            {
              name: "Pads",
              manufacturer: "OEM",
              reference: "PAD-1",
              quantity: 2,
              unitPriceCents: 3_000,
            },
            { name: "Fluid", quantity: 1, unitPriceCents: 1_000 },
          ],
          workshop: "Garage",
          notes: "Front axle",
        },
        now,
      ),
    );
    expect(maintenance.partsCostCents).toBe(7_000);
    expect(maintenance.totalCostCents).toBe(12_000);
    expect(maintenance.parts).toHaveLength(2);
    expect(maintenance.parts[0]).toMatchObject({
      manufacturer: "OEM",
      reference: "PAD-1",
      totalPriceCents: 6_000,
    });
  });

  it("atomically advances mileage when maintenance is higher", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Service",
          category: "other",
          performedAt: "2026-06-01",
          mileageKm: 101_000,
          laborCostCents: 0,
          parts: [],
        },
        now,
      ),
    );
    expect(await Effect.runPromise(repository.getCurrentMileage(vehicle.id))).toBe(101_000);
    expect(await Effect.runPromise(repository.listMileageRecords(vehicle.id, page))).toHaveLength(
      1,
    );
  });

  it("does not add mileage when maintenance equals current mileage", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Inspection",
          category: "inspection",
          performedAt: "2026-06-01",
          mileageKm: 100_000,
          laborCostCents: 0,
          parts: [],
        },
        now,
      ),
    );
    expect(await Effect.runPromise(repository.listMileageRecords(vehicle.id, page))).toHaveLength(
      0,
    );
  });

  it("rejects maintenance below current mileage without persisting it", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    expect(
      await left(
        repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title: "Old service",
            category: "other",
            performedAt: "2025-01-01",
            mileageKm: 99_000,
            laborCostCents: 0,
            parts: [],
          },
          now,
        ),
      ),
    ).toMatchObject({ _tag: "Left", left: { _tag: "MileageRegression" } });
    expect(await Effect.runPromise(repository.listMaintenance(vehicle.id, page))).toHaveLength(0);
  });

  it("updates maintenance parts and recalculates totals", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Service",
          category: "other",
          performedAt: "2026-06-01",
          mileageKm: 100_000,
          laborCostCents: 100,
          parts: [{ name: "Old", quantity: 1, unitPriceCents: 100 }],
        },
        now,
      ),
    );
    const updated = await Effect.runPromise(
      repository.updateMaintenance(
        created.id,
        {
          title: "Updated",
          category: "filters",
          performedAt: "2026-06-02",
          mileageKm: 100_001,
          laborCostCents: 200,
          parts: [{ name: "New", quantity: 2, unitPriceCents: 150 }],
          workshop: "Shop",
          notes: "Done",
        },
        "2026-06-16T00:00:00.000Z",
      ),
    );
    expect(updated).toMatchObject({
      title: "Updated",
      category: "filters",
      mileageKm: 100_001,
      laborCostCents: 200,
      partsCostCents: 300,
      totalCostCents: 500,
      workshop: "Shop",
      notes: "Done",
    });
    expect(updated.parts.map(({ name }) => name)).toEqual(["New"]);
  });

  it("clears maintenance workshop and notes", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Service",
          category: "other",
          performedAt: "2026-06-01",
          mileageKm: 100_000,
          laborCostCents: 0,
          parts: [],
          workshop: "Shop",
          notes: "Note",
        },
        now,
      ),
    );
    const updated = await Effect.runPromise(
      repository.updateMaintenance(created.id, { workshop: null, notes: null }, now),
    );
    expect(updated.workshop).toBeUndefined();
    expect(updated.notes).toBeUndefined();
  });

  it("sorts and paginates maintenance", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (const [title, performedAt] of [
      ["One", "2026-01-01"],
      ["Two", "2026-02-01"],
      ["Three", "2026-03-01"],
    ] as const) {
      await Effect.runPromise(
        repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title,
            category: "other",
            performedAt,
            mileageKm: 100_000,
            laborCostCents: 0,
            parts: [],
          },
          now,
        ),
      );
    }
    const records = await Effect.runPromise(
      repository.listMaintenance(vehicle.id, { limit: 1, offset: 1 }),
    );
    expect(records.map(({ title }) => title)).toEqual(["Two"]);
  });

  it("returns MaintenanceEventNotFound for missing update and delete", async () => {
    const repository = makeInMemoryGarageRepository();
    const id = createId(MaintenanceEventIdSchema);
    expect(await left(repository.updateMaintenance(id, {}, now))).toMatchObject({
      _tag: "Left",
      left: { _tag: "MaintenanceEventNotFound" },
    });
    expect(await left(repository.deleteMaintenance(id))).toMatchObject({
      _tag: "Left",
      left: { _tag: "MaintenanceEventNotFound" },
    });
  });
});

describe("in-memory expense repository", () => {
  it("creates, reads, updates, lists, and deletes an expense", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addExpense(
        {
          vehicleId: vehicle.id,
          category: "fuel",
          description: "Fuel",
          amountCents: 7_500,
          incurredAt: "2026-06-01",
          mileageKm: 100_500,
          vendor: "Station",
          notes: "Full tank",
        },
        now,
      ),
    );
    expect(await Effect.runPromise(repository.listExpenses(vehicle.id, page))).toEqual([created]);
    const updated = await Effect.runPromise(
      repository.updateExpense(
        created.id,
        {
          category: "parking",
          description: "Parking",
          amountCents: 2_000,
          incurredAt: "2026-06-02",
          mileageKm: null,
          vendor: null,
          notes: null,
        },
        now,
      ),
    );
    expect(updated).toMatchObject({
      category: "parking",
      description: "Parking",
      amountCents: 2_000,
      incurredAt: "2026-06-02",
    });
    expect(updated.mileageKm).toBeUndefined();
    expect(updated.vendor).toBeUndefined();
    expect(updated.notes).toBeUndefined();
    await Effect.runPromise(repository.deleteExpense(created.id));
    expect(await Effect.runPromise(repository.listExpenses(vehicle.id, page))).toEqual([]);
  });

  it("sorts and paginates expenses newest first", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (const [description, incurredAt] of [
      ["One", "2026-01-01"],
      ["Two", "2026-02-01"],
      ["Three", "2026-03-01"],
    ] as const) {
      await Effect.runPromise(
        repository.addExpense(
          {
            vehicleId: vehicle.id,
            category: "other",
            description,
            amountCents: 100,
            incurredAt,
          },
          now,
        ),
      );
    }
    const records = await Effect.runPromise(
      repository.listExpenses(vehicle.id, { limit: 1, offset: 1 }),
    );
    expect(records.map(({ description }) => description)).toEqual(["Two"]);
  });

  it("returns ExpenseNotFound for missing expense mutations", async () => {
    const repository = makeInMemoryGarageRepository();
    const id = createId(ExpenseIdSchema);
    expect(await left(repository.updateExpense(id, {}, now))).toMatchObject({
      _tag: "Left",
      left: { _tag: "ExpenseNotFound" },
    });
    expect(await left(repository.deleteExpense(id))).toMatchObject({
      _tag: "Left",
      left: { _tag: "ExpenseNotFound" },
    });
  });
});

describe("in-memory reminder repository", () => {
  it("creates and lists a reminder", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addReminder(
        {
          vehicleId: vehicle.id,
          title: "Brakes",
          category: "brakes",
          dueDate: "2026-07-01",
          notes: "Inspect pads",
        },
        now,
      ),
    );
    expect(await Effect.runPromise(repository.listReminders(vehicle.id, page))).toEqual([created]);
  });

  it("completes a non-recurring reminder without a successor", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addReminder(
        {
          vehicleId: vehicle.id,
          title: "Brakes",
          category: "brakes",
          dueMileageKm: 110_000,
        },
        now,
      ),
    );
    const completed = await Effect.runPromise(
      repository.completeReminder(created.id, "2026-06-20T00:00:00.000Z"),
    );
    expect(completed.completed.completedAt).toBe("2026-06-20T00:00:00.000Z");
    expect(completed.next).toBeNull();
  });

  it("creates a recurring reminder successor", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.addReminder(
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
      ),
    );
    const completed = await Effect.runPromise(repository.completeReminder(created.id, now));
    expect(completed.next).toMatchObject({
      dueDate: "2027-06-30",
      dueMileageKm: 120_000,
    });
    expect(await Effect.runPromise(repository.listReminders(vehicle.id, page))).toHaveLength(2);
  });

  it("sorts reminders deterministically and paginates", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (const [title, dueDate] of [
      ["Later", "2026-09-01"],
      ["Soon", "2026-07-01"],
      ["Middle", "2026-08-01"],
    ] as const) {
      await Effect.runPromise(
        repository.addReminder({ vehicleId: vehicle.id, title, category: "other", dueDate }, now),
      );
    }
    const records = await Effect.runPromise(
      repository.listReminders(vehicle.id, { limit: 1, offset: 1 }),
    );
    expect(records.map(({ title }) => title)).toEqual(["Middle"]);
  });

  it("returns ReminderNotFound when completing a missing reminder", async () => {
    const repository = makeInMemoryGarageRepository();
    expect(await left(repository.completeReminder(createId(ReminderIdSchema), now))).toMatchObject({
      _tag: "Left",
      left: { _tag: "ReminderNotFound" },
    });
  });
});

describe("in-memory document repository", () => {
  it("creates, lists, and removes a full document record", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const created = await Effect.runPromise(
      repository.attachDocument(
        {
          vehicleId: vehicle.id,
          type: "invoice",
          title: "Invoice",
          localPath: "/garage/docs/invoice.pdf",
          mimeType: "application/pdf",
          recordedAt: "2026-06-01",
          notes: "Original",
        },
        now,
      ),
    );
    expect(await Effect.runPromise(repository.listDocuments(vehicle.id, page))).toEqual([created]);
    await Effect.runPromise(repository.removeDocument(created.id));
    expect(await Effect.runPromise(repository.listDocuments(vehicle.id, page))).toEqual([]);
  });

  it("sorts and paginates documents", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (const [title, recordedAt] of [
      ["One", "2026-01-01"],
      ["Two", "2026-02-01"],
      ["Three", "2026-03-01"],
    ] as const) {
      await Effect.runPromise(
        repository.attachDocument(
          {
            vehicleId: vehicle.id,
            type: "other",
            title,
            localPath: `/tmp/${title}.pdf`,
            recordedAt,
          },
          now,
        ),
      );
    }
    const records = await Effect.runPromise(
      repository.listDocuments(vehicle.id, { limit: 1, offset: 1 }),
    );
    expect(records.map(({ title }) => title)).toEqual(["Two"]);
  });

  it("returns DocumentNotFound when removing a missing document", async () => {
    const repository = makeInMemoryGarageRepository();
    expect(await left(repository.removeDocument(createId(DocumentIdSchema)))).toMatchObject({
      _tag: "Left",
      left: { _tag: "DocumentNotFound" },
    });
  });
});

describe("in-memory summary repository", () => {
  it("returns a zero-cost summary for a new vehicle", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    const summary = await Effect.runPromise(repository.getVehicleSummary(vehicle.id, now));
    expect(summary).toMatchObject({
      currentMileageKm: 100_000,
      lastMaintenance: null,
      recentMaintenance: [],
      reminders: [],
      totalExpensesCents: 0,
      totalMaintenanceCents: 0,
      totalRecordedCostCents: 0,
      costPerKmCents: null,
      costByCategory: {},
    });
  });

  it("aggregates costs, mileage, recent maintenance, and due reminders", async () => {
    const repository = makeInMemoryGarageRepository();
    const vehicle = await createVehicle(repository);
    for (let index = 0; index < 7; index += 1) {
      await Effect.runPromise(
        repository.addMaintenance(
          {
            vehicleId: vehicle.id,
            title: `Service ${index}`,
            category: index % 2 === 0 ? "brakes" : "filters",
            performedAt: `2026-0${index + 1}-01`,
            mileageKm: 101_000 + index,
            laborCostCents: 100,
            parts: [],
          },
          now,
        ),
      );
    }
    await Effect.runPromise(
      repository.addExpense(
        {
          vehicleId: vehicle.id,
          category: "fuel",
          description: "Fuel",
          amountCents: 300,
          incurredAt: "2026-06-01",
        },
        now,
      ),
    );
    await Effect.runPromise(
      repository.addReminder(
        {
          vehicleId: vehicle.id,
          title: "Due",
          category: "other",
          dueDate: "2026-06-20",
        },
        now,
      ),
    );
    await Effect.runPromise(
      repository.addReminder(
        {
          vehicleId: vehicle.id,
          title: "Future",
          category: "other",
          dueDate: "2027-01-01",
        },
        now,
      ),
    );
    const summary = await Effect.runPromise(repository.getVehicleSummary(vehicle.id, now));
    expect(summary.currentMileageKm).toBe(101_006);
    expect(summary.recentMaintenance).toHaveLength(5);
    expect(summary.lastMaintenance).toEqual({
      performedAt: "2026-07-01",
      mileageKm: 101_006,
    });
    expect(summary.reminders.map(({ title }) => title)).toEqual(["Due"]);
    expect(summary.totalMaintenanceCents).toBe(700);
    expect(summary.totalExpensesCents).toBe(300);
    expect(summary.totalRecordedCostCents).toBe(1_000);
    expect(summary.costPerKmCents).toBeCloseTo(1_000 / 1_006);
    expect(summary.costByCategory).toEqual({
      "expense:fuel": 300,
      "maintenance:brakes": 400,
      "maintenance:filters": 300,
    });
  });

  it.each([
    "getCurrentMileage",
    "listMileageRecords",
    "listMaintenance",
    "listExpenses",
    "listReminders",
    "listDocuments",
    "getVehicleSummary",
  ] as const)("returns VehicleNotFound from %s", async (operation) => {
    const repository = makeInMemoryGarageRepository();
    const missing = createId(VehicleIdSchema);
    const effects: Readonly<Record<typeof operation, Effect.Effect<void, unknown>>> = {
      getCurrentMileage: repository.getCurrentMileage(missing).pipe(Effect.asVoid),
      listMileageRecords: repository.listMileageRecords(missing, page).pipe(Effect.asVoid),
      listMaintenance: repository.listMaintenance(missing, page).pipe(Effect.asVoid),
      listExpenses: repository.listExpenses(missing, page).pipe(Effect.asVoid),
      listReminders: repository.listReminders(missing, page).pipe(Effect.asVoid),
      listDocuments: repository.listDocuments(missing, page).pipe(Effect.asVoid),
      getVehicleSummary: repository.getVehicleSummary(missing, now).pipe(Effect.asVoid),
    };
    expect(await left(effects[operation])).toMatchObject({
      _tag: "Left",
      left: { _tag: "VehicleNotFound" },
    });
  });
});
