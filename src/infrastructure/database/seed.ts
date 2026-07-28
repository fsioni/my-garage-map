import { Effect, ManagedRuntime } from "effect";
import { GarageRepository } from "../../application/ports.js";
import { loadConfig } from "../../config/config.js";
import { sqliteRepositoryLayer } from "./sqlite.js";

const now = "2026-01-01T00:00:00.000Z";
const config = await Effect.runPromise(loadConfig());
const runtime = ManagedRuntime.make(sqliteRepositoryLayer(config.dbPath));

const seed = Effect.gen(function* () {
  const repository = yield* GarageRepository;
  const existing = yield* repository.listVehicles({ limit: 1, offset: 0 });
  if (existing.length > 0) {
    return yield* Effect.fail(
      new Error("Seed refused: the target database already contains a vehicle"),
    );
  }
  const vehicle = yield* repository.createVehicle(
    {
      name: "Peugeot 2008",
      make: "Peugeot",
      model: "2008 1.6 e-HDi Allure",
      firstRegistrationDate: "2013-01-01",
      initialMileageKm: 185_146,
      currency: "EUR",
    },
    now,
  );
  yield* repository.addExpense(
    {
      vehicleId: vehicle.id,
      category: "purchase",
      description: "Achat du véhicule",
      amountCents: 0,
      incurredAt: "2026-01-01",
    },
    now,
  );
  yield* repository.addExpense(
    {
      vehicleId: vehicle.id,
      category: "transport",
      description: "Transport du véhicule",
      amountCents: 0,
      incurredAt: "2026-01-01",
    },
    now,
  );
  yield* repository.addReminder(
    {
      vehicleId: vehicle.id,
      title: "Contrôle des freins",
      category: "brakes",
      dueMileageKm: 190_000,
    },
    now,
  );
  return vehicle;
});

try {
  const vehicle = await runtime.runPromise(seed);
  process.stderr.write(
    `${JSON.stringify({ level: "info", event: "seed_completed", vehicleId: vehicle.id })}\n`,
  );
} finally {
  await runtime.dispose();
}
