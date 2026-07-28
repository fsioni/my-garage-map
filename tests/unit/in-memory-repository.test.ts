import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { makeInMemoryGarageRepository } from "../../src/infrastructure/database/in-memory-repository.js";

describe("in-memory repository adapter", () => {
  it("supports deterministic use-case tests without SQLite", async () => {
    const repository = makeInMemoryGarageRepository();
    const now = "2026-06-01T00:00:00.000Z";
    const vehicle = await Effect.runPromise(
      repository.createVehicle(
        { name: "Test", make: "Make", model: "Model", initialMileageKm: 1_000 },
        now,
      ),
    );
    const maintenance = await Effect.runPromise(
      repository.addMaintenance(
        {
          vehicleId: vehicle.id,
          title: "Service",
          category: "other",
          performedAt: "2026-05-01",
          mileageKm: 1_500,
          laborCostCents: 100,
          parts: [{ name: "Part", quantity: 2, unitPriceCents: 50 }],
        },
        now,
      ),
    );
    const summary = await Effect.runPromise(repository.getVehicleSummary(vehicle.id, now));
    expect(maintenance.totalCostCents).toBe(200);
    expect(summary.currentMileageKm).toBe(1_500);
    expect(summary.totalMaintenanceCents).toBe(200);
  });
});
