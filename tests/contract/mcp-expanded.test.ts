import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import {
  callTool,
  callToolError,
  createTestVehicle,
  setupMcpClient,
} from "../support/mcp-client.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()));
});

const setup = async (): Promise<Client> => {
  const context = await setupMcpClient();
  cleanup.push(context.close);
  return context.client;
};

const id = "43eb1a7c-b42e-4a7b-a963-b3454c7b66de";
const validVehicle = {
  name: "Daily",
  make: "Peugeot",
  model: "2008",
  initialMileageKm: 100_000,
};

describe("MCP discovery contract", () => {
  it("publishes titles, descriptions, object schemas and strict inputs for every tool", async () => {
    const client = await setup();
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(24);
    for (const tool of tools) {
      expect(tool.title).toBeTypeOf("string");
      expect(tool.title?.length).toBeGreaterThan(3);
      expect(tool.description?.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema["additionalProperties"]).toBe(false);
    }
  });

  it("publishes the static vehicles resource and five vehicle templates", async () => {
    const client = await setup();
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    expect(resources.resources).toEqual([
      expect.objectContaining({
        name: "vehicles",
        uri: "garage://vehicles",
        mimeType: "application/json",
      }),
    ]);
    expect(templates.resourceTemplates.map(({ uriTemplate }) => uriTemplate).sort()).toEqual(
      [
        "garage://vehicles/{vehicleId}",
        "garage://vehicles/{vehicleId}/expenses",
        "garage://vehicles/{vehicleId}/maintenance",
        "garage://vehicles/{vehicleId}/reminders",
        "garage://vehicles/{vehicleId}/summary",
      ].sort(),
    );
  });

  it("uses defaults declared in the public schemas", async () => {
    const client = await setup();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool.inputSchema]));
    expect(byName.get("list_vehicles")?.properties).toMatchObject({
      limit: { default: 50 },
      offset: { default: 0 },
    });
    expect(byName.get("create_vehicle")?.properties).toMatchObject({
      currency: { default: "EUR" },
    });
    expect(byName.get("record_mileage")?.properties).toMatchObject({
      source: { default: "manual" },
    });
  });
});

const invalidCalls: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
  ["unknown create field", "create_vehicle", { ...validVehicle, surprise: true }],
  ["missing name", "create_vehicle", { make: "A", model: "B", initialMileageKm: 0 }],
  ["blank name", "create_vehicle", { ...validVehicle, name: "   " }],
  ["long name", "create_vehicle", { ...validVehicle, name: "x".repeat(201) }],
  ["negative initial mileage", "create_vehicle", { ...validVehicle, initialMileageKm: -1 }],
  ["fractional initial mileage", "create_vehicle", { ...validVehicle, initialMileageKm: 1.5 }],
  ["bad currency", "create_vehicle", { ...validVehicle, currency: "EURO" }],
  ["bad purchase money", "create_vehicle", { ...validVehicle, purchasePriceEur: "12.345" }],
  ["impossible purchase date", "create_vehicle", { ...validVehicle, purchaseDate: "2026-02-30" }],
  ["long notes", "create_vehicle", { ...validVehicle, notes: "x".repeat(4_001) }],
  ["zero page limit", "list_vehicles", { limit: 0 }],
  ["large page limit", "list_vehicles", { limit: 201 }],
  ["fractional page limit", "list_vehicles", { limit: 1.5 }],
  ["negative page offset", "list_vehicles", { offset: -1 }],
  ["unknown page field", "list_vehicles", { cursor: "next" }],
  ["invalid vehicle UUID", "get_vehicle", { vehicleId: "not-an-id" }],
  ["unknown update field", "update_vehicle", { vehicleId: id, immutable: true }],
  ["empty update make", "update_vehicle", { vehicleId: id, make: "" }],
  ["invalid update date", "update_vehicle", { vehicleId: id, purchaseDate: "tomorrow" }],
  [
    "negative mileage",
    "record_mileage",
    { vehicleId: id, mileageKm: -1, recordedAt: "2026-01-01" },
  ],
  [
    "invalid mileage date",
    "record_mileage",
    { vehicleId: id, mileageKm: 1, recordedAt: "2026-13-01" },
  ],
  [
    "invalid mileage source",
    "record_mileage",
    { vehicleId: id, mileageKm: 1, recordedAt: "2026-01-01", source: "gps" },
  ],
  ["missing maintenance title", "add_maintenance", { vehicleId: id }],
  [
    "invalid maintenance category",
    "add_maintenance",
    {
      vehicleId: id,
      title: "Oil",
      category: "magic",
      performedAt: "2026-01-01",
      mileageKm: 1,
      laborCostEur: "0",
    },
  ],
  [
    "too many maintenance parts",
    "add_maintenance",
    {
      vehicleId: id,
      title: "Oil",
      category: "other",
      performedAt: "2026-01-01",
      mileageKm: 1,
      laborCostEur: "0",
      parts: Array.from({ length: 101 }, () => ({
        name: "Part",
        quantity: 1,
        unitPriceEur: "1",
      })),
    },
  ],
  [
    "zero part quantity",
    "add_maintenance",
    {
      vehicleId: id,
      title: "Oil",
      category: "other",
      performedAt: "2026-01-01",
      mileageKm: 1,
      laborCostEur: "0",
      parts: [{ name: "Part", quantity: 0, unitPriceEur: "1" }],
    },
  ],
  [
    "large part quantity",
    "add_maintenance",
    {
      vehicleId: id,
      title: "Oil",
      category: "other",
      performedAt: "2026-01-01",
      mileageKm: 1,
      laborCostEur: "0",
      parts: [{ name: "Part", quantity: 10_001, unitPriceEur: "1" }],
    },
  ],
  [
    "bad part money",
    "add_maintenance",
    {
      vehicleId: id,
      title: "Oil",
      category: "other",
      performedAt: "2026-01-01",
      mileageKm: 1,
      laborCostEur: "0",
      parts: [{ name: "Part", quantity: 1, unitPriceEur: "-1" }],
    },
  ],
  ["invalid maintenance id", "get_maintenance", { maintenanceEventId: "x" }],
  ["empty expense description", "add_expense", { vehicleId: id, description: "" }],
  [
    "invalid expense category",
    "add_expense",
    {
      vehicleId: id,
      category: "otherish",
      description: "Item",
      amountEur: "1",
      incurredAt: "2026-01-01",
    },
  ],
  [
    "negative expense mileage",
    "add_expense",
    {
      vehicleId: id,
      category: "other",
      description: "Item",
      amountEur: "1",
      incurredAt: "2026-01-01",
      mileageKm: -1,
    },
  ],
  ["invalid expense id", "update_expense", { expenseId: "x", amountEur: "1" }],
  [
    "reminder without due target",
    "add_reminder",
    { vehicleId: id, title: "Oil", category: "engine_oil" },
  ],
  [
    "month recurrence without date",
    "add_reminder",
    {
      vehicleId: id,
      title: "Oil",
      category: "engine_oil",
      dueMileageKm: 10,
      recurrenceMonths: 12,
    },
  ],
  [
    "mileage recurrence without mileage",
    "add_reminder",
    {
      vehicleId: id,
      title: "Oil",
      category: "engine_oil",
      dueDate: "2026-01-01",
      recurrenceKm: 10,
    },
  ],
  [
    "zero recurrence",
    "add_reminder",
    {
      vehicleId: id,
      title: "Oil",
      category: "engine_oil",
      dueDate: "2026-01-01",
      recurrenceMonths: 0,
    },
  ],
  ["invalid reminder id", "complete_reminder", { reminderId: "x" }],
  [
    "empty document path",
    "attach_document",
    {
      vehicleId: id,
      type: "invoice",
      title: "Invoice",
      localPath: "",
      recordedAt: "2026-01-01",
    },
  ],
  [
    "document with two parents",
    "attach_document",
    {
      vehicleId: id,
      maintenanceEventId: id,
      expenseId: id,
      type: "invoice",
      title: "Invoice",
      localPath: "/garage/docs/a.pdf",
      recordedAt: "2026-01-01",
    },
  ],
  ["invalid document id", "remove_document", { documentId: "x" }],
];

describe("MCP schema validation", () => {
  it.each(invalidCalls)("rejects %s", async (_case, tool, args) => {
    const client = await setup();
    const response = await client.callTool({ name: tool, arguments: args });
    expect(response.isError).toBe(true);
  });
});

describe("MCP business error contract", () => {
  it.each([
    ["get_vehicle", { vehicleId: id }, "VehicleNotFound"],
    ["update_vehicle", { vehicleId: id, name: "Missing" }, "VehicleNotFound"],
    ["get_current_mileage", { vehicleId: id }, "VehicleNotFound"],
    ["list_mileage_records", { vehicleId: id }, "VehicleNotFound"],
    ["list_maintenance", { vehicleId: id }, "VehicleNotFound"],
    ["list_expenses", { vehicleId: id }, "VehicleNotFound"],
    ["list_reminders", { vehicleId: id }, "VehicleNotFound"],
    ["list_due_reminders", { vehicleId: id }, "VehicleNotFound"],
    ["list_documents", { vehicleId: id }, "VehicleNotFound"],
    ["get_vehicle_summary", { vehicleId: id }, "VehicleNotFound"],
    ["get_maintenance", { maintenanceEventId: id }, "MaintenanceEventNotFound"],
    [
      "update_maintenance",
      { maintenanceEventId: id, title: "Missing" },
      "MaintenanceEventNotFound",
    ],
    ["delete_maintenance", { maintenanceEventId: id }, "MaintenanceEventNotFound"],
    ["update_expense", { expenseId: id, vendor: "Missing" }, "ExpenseNotFound"],
    ["delete_expense", { expenseId: id }, "ExpenseNotFound"],
    ["complete_reminder", { reminderId: id }, "ReminderNotFound"],
    ["remove_document", { documentId: id }, "DocumentNotFound"],
  ] as const)("returns a safe %s error", async (tool, args, expectedCode) => {
    const client = await setup();
    const error = await callToolError(client, tool, args);
    expect(error.code).toBe(expectedCode);
    expect(error.message).toBeTruthy();
    const serialized = JSON.stringify(error.response);
    expect(serialized).not.toContain("node_modules");
    expect(serialized).not.toContain("SQLITE_");
    expect(serialized).not.toContain(" at ");
  });

  it("rejects mileage regression with current and attempted values", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const error = await callToolError(client, "record_mileage", {
      vehicleId,
      mileageKm: 99_999,
      recordedAt: "2026-05-01",
    });
    expect(error).toMatchObject({
      code: "MileageRegression",
      message: expect.stringContaining("99999"),
    });
    expect(error.message).toContain("100000");
  });

  it("rejects an identical mileage record with a stable domain code", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const args = { vehicleId, mileageKm: 100_000, recordedAt: "2026-05-01" };
    await callTool(client, "record_mileage", args);
    const error = await callToolError(client, "record_mileage", args);
    expect(error.code).toBe("InvalidMileage");
  });

  it("rejects documents outside the configured root", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const error = await callToolError(client, "attach_document", {
      vehicleId,
      type: "invoice",
      title: "Invoice",
      localPath: "/tmp/outside.pdf",
      recordedAt: "2026-01-01",
    });
    expect(error).toMatchObject({
      code: "ValidationError",
      message: "Document path is outside GARAGE_DOCUMENT_ROOT",
    });
  });
});

describe("MCP successful response and optionals contract", () => {
  it("keeps text and structured tool responses semantically identical", async () => {
    const client = await setup();
    const response = await client.callTool({
      name: "create_vehicle",
      arguments: {
        ...validVehicle,
        registrationNumber: "AB-123-CD",
        vin: " vf3contract ",
        firstRegistrationDate: "2020-01-01",
        purchaseDate: "2025-01-01",
        purchasePriceEur: "12000.50",
        currency: "EUR",
        notes: "Imported",
      },
    });
    expect(response.isError).not.toBe(true);
    const parsedResponse = z
      .object({
        content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
        structuredContent: z.object({ result: z.unknown() }),
      })
      .parse(response);
    const text = parsedResponse.content[0];
    expect(text?.type).toBe("text");
    if (text?.text === undefined) throw new Error("Expected text content");
    expect(JSON.parse(text.text)).toEqual(parsedResponse.structuredContent.result);
    expect(response.structuredContent).toMatchObject({
      result: {
        registrationNumber: "AB-123-CD",
        vin: "VF3CONTRACT",
        purchasePriceCents: 1_200_050,
      },
    });
  });

  it("applies pagination defaults and enforces pagination slices", async () => {
    const client = await setup();
    for (const name of ["Zulu", "Alpha", "Mike"]) {
      await callTool(client, "create_vehicle", { ...validVehicle, name });
    }
    const all = z
      .array(z.object({ name: z.string() }))
      .parse(await callTool(client, "list_vehicles", {}));
    const slice = z
      .array(z.object({ name: z.string() }))
      .parse(await callTool(client, "list_vehicles", { limit: 1, offset: 1 }));
    expect(all.map(({ name }) => name)).toEqual(["Alpha", "Mike", "Zulu"]);
    expect(slice.map(({ name }) => name)).toEqual(["Mike"]);
  });

  it("supports clearing every nullable vehicle field", async () => {
    const client = await setup();
    const created = z.object({ id: z.string() }).parse(
      await callTool(client, "create_vehicle", {
        ...validVehicle,
        registrationNumber: "AA",
        vin: "VF3",
        firstRegistrationDate: "2020-01-01",
        purchaseDate: "2025-01-01",
        purchasePriceEur: "1",
        notes: "note",
      }),
    );
    const updated = await callTool(client, "update_vehicle", {
      vehicleId: created.id,
      registrationNumber: null,
      vin: null,
      firstRegistrationDate: null,
      purchaseDate: null,
      purchasePriceEur: null,
      notes: null,
    });
    expect(updated).toMatchObject({ id: created.id });
    for (const field of [
      "registrationNumber",
      "vin",
      "firstRegistrationDate",
      "purchaseDate",
      "purchasePriceCents",
      "notes",
    ]) {
      expect(updated).not.toHaveProperty(field);
    }
  });

  it("round-trips all maintenance optionals and replacement parts", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const created = z.object({ id: z.string() }).parse(
      await callTool(client, "add_maintenance", {
        vehicleId,
        title: "Oil",
        category: "engine_oil",
        performedAt: "2026-05-01",
        mileageKm: 101_000,
        laborCostEur: "20",
        workshop: "Initial",
        notes: "Before",
        parts: [
          {
            name: "Oil",
            manufacturer: "Maker",
            reference: "REF",
            quantity: 2,
            unitPriceEur: "10.50",
          },
        ],
      }),
    );
    const updated = await callTool(client, "update_maintenance", {
      maintenanceEventId: created.id,
      title: "Full oil service",
      category: "inspection",
      performedAt: "2026-05-02",
      mileageKm: 101_100,
      laborCostEur: "30",
      workshop: null,
      notes: null,
      parts: [{ name: "Filter", quantity: 1, unitPriceEur: "12" }],
    });
    expect(updated).toMatchObject({
      title: "Full oil service",
      category: "inspection",
      mileageKm: 101_100,
      laborCostCents: 3_000,
      parts: [{ name: "Filter", quantity: 1, unitPriceCents: 1_200 }],
      totalCostCents: 4_200,
    });
    expect(updated).not.toHaveProperty("workshop");
    expect(updated).not.toHaveProperty("notes");
  });

  it("round-trips and clears all optional expense fields", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const created = z.object({ id: z.string() }).parse(
      await callTool(client, "add_expense", {
        vehicleId,
        category: "fuel",
        description: "Fuel",
        amountEur: "75.50",
        incurredAt: "2026-05-01",
        mileageKm: 101_000,
        vendor: "Station",
        notes: "Full tank",
      }),
    );
    const updated = await callTool(client, "update_expense", {
      expenseId: created.id,
      category: "parking",
      description: "Parking",
      amountEur: "5",
      incurredAt: "2026-05-02",
      mileageKm: null,
      vendor: null,
      notes: null,
    });
    expect(updated).toMatchObject({
      category: "parking",
      description: "Parking",
      amountCents: 500,
      incurredAt: "2026-05-02",
    });
    expect(updated).not.toHaveProperty("mileageKm");
    expect(updated).not.toHaveProperty("vendor");
    expect(updated).not.toHaveProperty("notes");
  });

  it("filters upcoming reminders and returns due and overdue reminders", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    for (const [title, dueDate] of [
      ["Overdue", "2026-05-01"],
      ["Due", "2026-06-15"],
      ["Upcoming", "2027-01-01"],
    ] as const) {
      await callTool(client, "add_reminder", {
        vehicleId,
        title,
        category: "other",
        dueDate,
      });
    }
    const all = z
      .array(z.object({ title: z.string(), status: z.string() }))
      .parse(await callTool(client, "list_reminders", { vehicleId }));
    const due = z
      .array(z.object({ title: z.string(), status: z.string() }))
      .parse(await callTool(client, "list_due_reminders", { vehicleId }));
    expect(all.map(({ status }) => status).sort()).toEqual(["due", "overdue", "upcoming"]);
    expect(due.map(({ title }) => title).sort()).toEqual(["Due", "Overdue"]);
  });

  it("creates both next recurrence dimensions when completing a reminder", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const reminder = z.object({ id: z.string() }).parse(
      await callTool(client, "add_reminder", {
        vehicleId,
        title: "Combined",
        category: "other",
        dueDate: "2026-06-30",
        dueMileageKm: 105_000,
        recurrenceMonths: 3,
        recurrenceKm: 10_000,
        notes: "Keep",
      }),
    );
    const result = z
      .object({
        completed: z.object({ completedAt: z.string() }),
        next: z.object({
          dueDate: z.string(),
          dueMileageKm: z.number(),
          notes: z.string(),
        }),
      })
      .parse(await callTool(client, "complete_reminder", { reminderId: reminder.id }));
    expect(result).toMatchObject({
      completed: { completedAt: "2026-06-01T10:00:00.000Z" },
      next: { dueDate: "2026-09-30", dueMileageKm: 115_000, notes: "Keep" },
    });
  });

  it("accepts valid unlinked, maintenance-linked and expense-linked documents", async () => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const maintenance = z.object({ id: z.string() }).parse(
      await callTool(client, "add_maintenance", {
        vehicleId,
        title: "Oil",
        category: "engine_oil",
        performedAt: "2026-05-01",
        mileageKm: 101_000,
        laborCostEur: "0",
      }),
    );
    const expense = z.object({ id: z.string() }).parse(
      await callTool(client, "add_expense", {
        vehicleId,
        category: "fuel",
        description: "Fuel",
        amountEur: "1",
        incurredAt: "2026-05-01",
      }),
    );
    const parentArgs = [{}, { maintenanceEventId: maintenance.id }, { expenseId: expense.id }];
    for (const [index, parent] of parentArgs.entries()) {
      await callTool(client, "attach_document", {
        vehicleId,
        ...parent,
        type: "invoice",
        title: `Invoice ${index}`,
        localPath: `/garage/docs/${index}.pdf`,
        mimeType: "application/pdf",
        recordedAt: "2026-05-01",
        notes: "Stored",
      });
    }
    const documents = z
      .array(z.object({ localPath: z.string() }))
      .parse(await callTool(client, "list_documents", { vehicleId }));
    expect(documents).toHaveLength(3);
  });
});

describe("MCP resources and internal failures", () => {
  it.each([
    ["garage://vehicles/{id}", "name"],
    ["garage://vehicles/{id}/maintenance", undefined],
    ["garage://vehicles/{id}/expenses", undefined],
    ["garage://vehicles/{id}/reminders", undefined],
    ["garage://vehicles/{id}/summary", "currentMileageKm"],
  ] as const)("reads %s as JSON", async (template, expectedKey) => {
    const client = await setup();
    const vehicleId = await createTestVehicle(client);
    const uri = template.replace("{id}", vehicleId);
    const resource = await client.readResource({ uri });
    expect(resource.contents).toHaveLength(1);
    const content = resource.contents[0];
    expect(content?.mimeType).toBe("application/json");
    if (content === undefined || !("text" in content)) throw new Error("Expected text resource");
    const parsed = JSON.parse(content.text);
    if (expectedKey === undefined) expect(parsed).toEqual([]);
    else expect(parsed).toHaveProperty(expectedKey);
  });

  it("reads the static vehicles resource as JSON", async () => {
    const client = await setup();
    await createTestVehicle(client);
    const resource = await client.readResource({ uri: "garage://vehicles" });
    const content = resource.contents[0];
    if (content === undefined || !("text" in content)) throw new Error("Expected text resource");
    expect(JSON.parse(content.text)).toEqual([expect.objectContaining({ name: "Daily" })]);
  });

  it("serializes resource domain errors instead of throwing protocol errors", async () => {
    const client = await setup();
    const resource = await client.readResource({ uri: `garage://vehicles/${id}/summary` });
    const content = resource.contents[0];
    if (content === undefined || !("text" in content)) throw new Error("Expected text resource");
    expect(JSON.parse(content.text)).toEqual({
      error: {
        code: "VehicleNotFound",
        message: `Vehicle ${id} was not found`,
      },
    });
  });

  it("redacts unexpected tool failures", async () => {
    const context = await setupMcpClient({
      runner: {
        runPromise: () => Promise.reject(new Error("secret stack and SQL details")),
      },
    });
    cleanup.push(context.close);
    const error = await callToolError(context.client, "list_vehicles", {});
    expect(error).toMatchObject({
      code: "InternalError",
      message: "An unexpected internal error occurred",
    });
    expect(JSON.stringify(error.response)).not.toContain("secret");
  });

  it("redacts unexpected resource failures", async () => {
    const context = await setupMcpClient({
      runner: {
        runPromise: () => Promise.reject(new Error("secret stack and SQL details")),
      },
    });
    cleanup.push(context.close);
    const resource = await context.client.readResource({ uri: "garage://vehicles" });
    const content = resource.contents[0];
    if (content === undefined || !("text" in content)) throw new Error("Expected text resource");
    expect(JSON.parse(content.text)).toEqual({
      error: {
        code: "InternalError",
        message: "An unexpected internal error occurred",
      },
    });
  });
});
