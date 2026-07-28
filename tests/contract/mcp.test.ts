import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Layer, ManagedRuntime } from "effect";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { fixedClockLayer } from "../../src/infrastructure/clock/live-clock.js";
import { sqliteRepositoryLayer } from "../../src/infrastructure/database/sqlite.js";
import { documentStorageLayer } from "../../src/infrastructure/filesystem/document-storage.js";
import { createGarageServer } from "../../src/mcp/server.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

const setup = async () => {
  const layer = Layer.mergeAll(
    sqliteRepositoryLayer(":memory:"),
    fixedClockLayer("2026-06-01T10:00:00.000Z"),
    documentStorageLayer("/garage/docs"),
  );
  const runtime = ManagedRuntime.make(layer);
  const server = createGarageServer({ runPromise: (effect) => runtime.runPromise(effect) });
  const client = new Client({ name: "garage-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanup.push(async () => {
    await client.close();
    await server.close();
    await runtime.dispose();
  });
  return client;
};

const resultSchema = z.object({ result: z.unknown() });
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const response = await client.callTool({ name, arguments: args });
  expect(response.isError).not.toBe(true);
  return resultSchema.parse(response.structuredContent).result;
};

describe("MCP contract", () => {
  it("discovers the stable surface and runs a complete persisted scenario", async () => {
    const client = await setup();
    const tools = await client.listTools();
    const expected = [
      "create_vehicle",
      "list_vehicles",
      "get_vehicle",
      "update_vehicle",
      "record_mileage",
      "get_current_mileage",
      "list_mileage_records",
      "add_maintenance",
      "get_maintenance",
      "list_maintenance",
      "update_maintenance",
      "delete_maintenance",
      "add_expense",
      "list_expenses",
      "update_expense",
      "delete_expense",
      "add_reminder",
      "list_due_reminders",
      "list_reminders",
      "complete_reminder",
      "attach_document",
      "list_documents",
      "remove_document",
      "get_vehicle_summary",
    ];
    expect(tools.tools.map(({ name }) => name).sort()).toEqual(expected.sort());
    expect(tools.tools.every(({ description }) => (description?.length ?? 0) > 5)).toBe(true);
    const createVehicleResult = z.object({ id: z.string() }).parse(
      await call(client, "create_vehicle", {
        name: "Daily",
        make: "Peugeot",
        model: "2008",
        initialMileageKm: 100_000,
        purchasePriceEur: "10000",
      }),
    );
    const vehicleId = createVehicleResult.id;
    await call(client, "update_vehicle", { vehicleId, vin: "vf3contract" });
    await call(client, "record_mileage", {
      vehicleId,
      mileageKm: 101_000,
      recordedAt: "2026-05-01",
      source: "manual",
    });
    const maintenance = z.object({ id: z.string() }).parse(
      await call(client, "add_maintenance", {
        vehicleId,
        title: "Oil",
        category: "engine_oil",
        performedAt: "2026-05-20",
        mileageKm: 102_000,
        laborCostEur: "50",
        parts: [{ name: "Oil", quantity: 1, unitPriceEur: "40" }],
      }),
    );
    await call(client, "update_maintenance", {
      maintenanceEventId: maintenance.id,
      workshop: "Garage",
    });
    await call(client, "get_maintenance", { maintenanceEventId: maintenance.id });
    const expense = z.object({ id: z.string() }).parse(
      await call(client, "add_expense", {
        vehicleId,
        category: "fuel",
        description: "Fuel",
        amountEur: "75.50",
        incurredAt: "2026-05-21",
      }),
    );
    await call(client, "update_expense", { expenseId: expense.id, vendor: "Station" });
    const reminder = z.object({ id: z.string() }).parse(
      await call(client, "add_reminder", {
        vehicleId,
        title: "Next oil",
        category: "engine_oil",
        dueDate: "2026-06-15",
        recurrenceMonths: 12,
      }),
    );
    await call(client, "list_due_reminders", { vehicleId });
    await call(client, "list_reminders", { vehicleId });
    await call(client, "complete_reminder", { reminderId: reminder.id });
    const document = z.object({ id: z.string() }).parse(
      await call(client, "attach_document", {
        vehicleId,
        maintenanceEventId: maintenance.id,
        type: "invoice",
        title: "Invoice",
        localPath: "/garage/docs/invoice.pdf",
        recordedAt: "2026-05-20",
      }),
    );
    await call(client, "list_documents", { vehicleId });
    const summary = z
      .object({
        currentMileageKm: z.number(),
        totalExpensesCents: z.number(),
        totalMaintenanceCents: z.number(),
      })
      .parse(await call(client, "get_vehicle_summary", { vehicleId }));
    expect(summary).toEqual({
      currentMileageKm: 102_000,
      totalExpensesCents: 7_550,
      totalMaintenanceCents: 9_000,
    });
    await call(client, "list_vehicles", {});
    await call(client, "get_vehicle", { vehicleId });
    await call(client, "get_current_mileage", { vehicleId });
    await call(client, "list_mileage_records", { vehicleId });
    await call(client, "list_maintenance", { vehicleId });
    await call(client, "list_expenses", { vehicleId });

    const resources = await client.listResources();
    expect(resources.resources.map(({ uri }) => uri)).toContain("garage://vehicles");
    const vehicleResource = await client.readResource({ uri: `garage://vehicles/${vehicleId}` });
    expect(vehicleResource.contents[0]?.mimeType).toBe("application/json");
    expect(vehicleResource.contents[0]).toHaveProperty("text");
    await client.readResource({ uri: `garage://vehicles/${vehicleId}/maintenance` });
    await client.readResource({ uri: `garage://vehicles/${vehicleId}/expenses` });
    await client.readResource({ uri: `garage://vehicles/${vehicleId}/reminders` });
    await client.readResource({ uri: `garage://vehicles/${vehicleId}/summary` });

    await call(client, "remove_document", { documentId: document.id });
    await call(client, "delete_expense", { expenseId: expense.id });
    await call(client, "delete_maintenance", { maintenanceEventId: maintenance.id });
  });

  it("rejects invalid schemas and presents business errors without stack traces", async () => {
    const client = await setup();
    const unknownField = await client.callTool({
      name: "create_vehicle",
      arguments: {
        name: "Car",
        make: "Make",
        model: "Model",
        initialMileageKm: 0,
        unexpected: true,
      },
    });
    expect(unknownField.isError).toBe(true);
    const invalidMoney = await client.callTool({
      name: "create_vehicle",
      arguments: {
        name: "Car",
        make: "Make",
        model: "Model",
        initialMileageKm: 0,
        purchasePriceEur: "12.345",
      },
    });
    expect(invalidMoney.isError).toBe(true);
    const missing = await client.callTool({
      name: "get_vehicle",
      arguments: { vehicleId: "43eb1a7c-b42e-4a7b-a963-b3454c7b66de" },
    });
    expect(missing.isError).toBe(true);
    const serialized = JSON.stringify(missing);
    expect(serialized).toContain("VehicleNotFound");
    expect(serialized).not.toContain("at ");
    expect(serialized).not.toContain("SQLITE");
  });
});
