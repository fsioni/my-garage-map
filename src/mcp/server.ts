import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema } from "effect";
import { z } from "zod";
import { AppClock, DocumentStorage, GarageRepository } from "../application/ports.js";
import type { DomainError } from "../domain/errors.js";
import {
  DocumentIdSchema,
  ExpenseIdSchema,
  expenseCategories,
  MaintenanceEventIdSchema,
  maintenanceCategories,
  mileageSources,
  ReminderIdSchema,
  VehicleIdSchema,
} from "../domain/models.js";
import {
  isIsoDate,
  isNonNegativeInteger,
  nonEmpty,
  normalizeVin,
  parseMoney,
  reminderStatus,
} from "../domain/rules.js";
import { presentError, presentUnknownError } from "./presenters.js";

type Services = GarageRepository | AppClock | DocumentStorage;
export interface EffectRunner {
  readonly runPromise: <A>(effect: Effect.Effect<A, DomainError, Services>) => Promise<A>;
}

const text = z.string().trim().min(1).max(200);
const notes = z.string().trim().max(4_000).optional();
const uuid = z.uuid();
const isoDate = z.string().refine(isIsoDate, "Expected an ISO 8601 date");
const money = z
  .string()
  .describe("Non-negative euro amount, for example 12.50")
  .refine(
    (value) => parseMoney(value) !== null,
    "Expected a non-negative euro amount with at most 2 decimals",
  );
const mileage = z.number().int().nonnegative();
const pageFields = {
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
};
const page = (input: { readonly limit: number; readonly offset: number }) => ({
  limit: input.limit,
  offset: input.offset,
});
const cents = (value: string): number => {
  const parsed = parseMoney(value);
  if (parsed === null) throw new Error("Validated money unexpectedly failed to parse");
  return parsed;
};
const vehicleId = (value: string) => Schema.decodeUnknownSync(VehicleIdSchema)(value);
const maintenanceId = (value: string) => Schema.decodeUnknownSync(MaintenanceEventIdSchema)(value);
const expenseId = (value: string) => Schema.decodeUnknownSync(ExpenseIdSchema)(value);
const reminderId = (value: string) => Schema.decodeUnknownSync(ReminderIdSchema)(value);
const documentId = (value: string) => Schema.decodeUnknownSync(DocumentIdSchema)(value);

const effectNow = <A>(
  operation: (repository: GarageRepository["Type"], now: string) => Effect.Effect<A, DomainError>,
) =>
  Effect.gen(function* () {
    const repository = yield* GarageRepository;
    const clock = yield* AppClock;
    const now = yield* clock.now;
    return yield* operation(repository, now);
  });

const effectRepository = <A>(
  operation: (repository: GarageRepository["Type"]) => Effect.Effect<A, DomainError>,
) =>
  Effect.gen(function* () {
    const repository = yield* GarageRepository;
    return yield* operation(repository);
  });

const success = <A>(result: A): CallToolResult => {
  const normalized = result === undefined ? null : result;
  return {
    content: [{ type: "text", text: JSON.stringify(normalized, null, 2) }],
    structuredContent: { result: normalized },
  };
};

const execute = async <A>(
  runner: EffectRunner,
  effect: Effect.Effect<A, DomainError, Services>,
): Promise<CallToolResult> => {
  try {
    const outcome = await runner.runPromise(Effect.either(effect));
    if (outcome._tag === "Right") return success(outcome.right);
    const presented = presentError(outcome.left);
    return {
      content: [{ type: "text", text: `${presented.code}: ${presented.message}` }],
      structuredContent: { error: presented },
      isError: true,
    };
  } catch (error) {
    const presented = presentUnknownError(error);
    return {
      content: [{ type: "text", text: `${presented.code}: ${presented.message}` }],
      structuredContent: { error: presented },
      isError: true,
    };
  }
};

const jsonResource = async <A>(
  runner: EffectRunner,
  uri: URL,
  effect: Effect.Effect<A, DomainError, Services>,
) => {
  try {
    const outcome = await runner.runPromise(Effect.either(effect));
    if (outcome._tag === "Left") {
      const presented = presentError(outcome.left);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({ error: presented }),
          },
        ],
      };
    }
    const value = outcome.right;
    return {
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(value) }],
    };
  } catch (error) {
    const presented = presentUnknownError(error);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ error: presented }),
        },
      ],
    };
  }
};

const vehicleSchema = {
  name: text.describe("Human-friendly vehicle name"),
  make: text.describe("Manufacturer"),
  model: text.describe("Model"),
  registrationNumber: z.string().trim().min(1).max(30).optional(),
  vin: z.string().trim().min(1).max(40).optional(),
  firstRegistrationDate: isoDate.optional(),
  purchaseDate: isoDate.optional(),
  purchasePriceEur: money.optional(),
  currency: z.string().trim().length(3).default("EUR"),
  initialMileageKm: mileage,
  notes,
};

const partSchema = z.strictObject({
  name: text,
  manufacturer: text.optional(),
  reference: text.optional(),
  quantity: z.number().int().positive().max(10_000),
  unitPriceEur: money,
});

const maintenanceInputSchema = {
  vehicleId: uuid,
  title: text,
  category: z.enum(maintenanceCategories),
  performedAt: isoDate,
  mileageKm: mileage,
  laborCostEur: money,
  parts: z.array(partSchema).max(100).default([]),
  workshop: text.optional(),
  notes,
};

const expenseInputSchema = {
  vehicleId: uuid,
  category: z.enum(expenseCategories),
  description: text,
  amountEur: money,
  incurredAt: isoDate,
  mileageKm: mileage.optional(),
  vendor: text.optional(),
  notes,
};

const reminderInputSchema = {
  vehicleId: uuid,
  title: text,
  category: z.enum(maintenanceCategories),
  dueDate: isoDate.optional(),
  dueMileageKm: mileage.optional(),
  recurrenceMonths: z.number().int().positive().max(1_200).optional(),
  recurrenceKm: z.number().int().positive().optional(),
  notes,
};

export const createGarageServer = (runner: EffectRunner): McpServer => {
  const server = new McpServer({ name: "garage-mcp", version: "1.0.0" });

  server.registerTool(
    "create_vehicle",
    {
      title: "Create vehicle",
      description: "Create a vehicle and its initial mileage baseline",
      inputSchema: z.strictObject(vehicleSchema),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.createVehicle(
            {
              name: input.name,
              make: input.make,
              model: input.model,
              ...(input.registrationNumber === undefined
                ? {}
                : { registrationNumber: input.registrationNumber }),
              ...(input.vin === undefined ? {} : { vin: normalizeVin(input.vin) ?? input.vin }),
              ...(input.firstRegistrationDate === undefined
                ? {}
                : { firstRegistrationDate: input.firstRegistrationDate }),
              ...(input.purchaseDate === undefined ? {} : { purchaseDate: input.purchaseDate }),
              ...(input.purchasePriceEur === undefined
                ? {}
                : { purchasePriceCents: cents(input.purchasePriceEur) }),
              currency: input.currency,
              initialMileageKm: input.initialMileageKm,
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "list_vehicles",
    {
      title: "List vehicles",
      description: "List vehicles with stable pagination",
      inputSchema: z.strictObject(pageFields),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) => repository.listVehicles(page(input))),
      ),
  );

  server.registerTool(
    "get_vehicle",
    {
      title: "Get vehicle",
      description: "Get one vehicle by UUID",
      inputSchema: z.strictObject({ vehicleId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) => repository.getVehicle(vehicleId(input.vehicleId))),
      ),
  );

  server.registerTool(
    "update_vehicle",
    {
      title: "Update vehicle",
      description: "Update mutable vehicle details; null clears an optional field",
      inputSchema: z.strictObject({
        vehicleId: uuid,
        name: text.optional(),
        make: text.optional(),
        model: text.optional(),
        registrationNumber: z.union([text, z.null()]).optional(),
        vin: z.union([text, z.null()]).optional(),
        firstRegistrationDate: z.union([isoDate, z.null()]).optional(),
        purchaseDate: z.union([isoDate, z.null()]).optional(),
        purchasePriceEur: z.union([money, z.null()]).optional(),
        currency: z.string().trim().length(3).optional(),
        notes: z.union([z.string().trim().max(4_000), z.null()]).optional(),
      }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.updateVehicle(
            vehicleId(input.vehicleId),
            {
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(input.make === undefined ? {} : { make: input.make }),
              ...(input.model === undefined ? {} : { model: input.model }),
              ...(input.registrationNumber === undefined
                ? {}
                : { registrationNumber: input.registrationNumber }),
              ...(input.vin === undefined
                ? {}
                : {
                    vin: input.vin === null ? null : (normalizeVin(input.vin) ?? input.vin),
                  }),
              ...(input.firstRegistrationDate === undefined
                ? {}
                : { firstRegistrationDate: input.firstRegistrationDate }),
              ...(input.purchaseDate === undefined ? {} : { purchaseDate: input.purchaseDate }),
              ...(input.purchasePriceEur === undefined
                ? {}
                : {
                    purchasePriceCents:
                      input.purchasePriceEur === null ? null : cents(input.purchasePriceEur),
                  }),
              ...(input.currency === undefined ? {} : { currency: input.currency }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "record_mileage",
    {
      title: "Record mileage",
      description: "Append a monotonic mileage record",
      inputSchema: z.strictObject({
        vehicleId: uuid,
        mileageKm: mileage,
        recordedAt: isoDate,
        source: z.enum(mileageSources).default("manual"),
        notes,
      }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.recordMileage(
            {
              vehicleId: vehicleId(input.vehicleId),
              mileageKm: input.mileageKm,
              recordedAt: input.recordedAt,
              source: input.source,
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "get_current_mileage",
    {
      title: "Get current mileage",
      description: "Get the latest mileage by date and creation time",
      inputSchema: z.strictObject({ vehicleId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) => repository.getCurrentMileage(vehicleId(input.vehicleId))),
      ),
  );

  server.registerTool(
    "list_mileage_records",
    {
      title: "List mileage records",
      description: "List mileage history, newest first",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.listMileageRecords(vehicleId(input.vehicleId), page(input)),
        ),
      ),
  );

  server.registerTool(
    "add_maintenance",
    {
      title: "Add maintenance",
      description: "Add maintenance, parts, and atomically advance mileage when needed",
      inputSchema: z.strictObject(maintenanceInputSchema),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.addMaintenance(
            {
              vehicleId: vehicleId(input.vehicleId),
              title: input.title,
              category: input.category,
              performedAt: input.performedAt,
              mileageKm: input.mileageKm,
              laborCostCents: cents(input.laborCostEur),
              parts: input.parts.map((part) => ({
                name: part.name,
                ...(part.manufacturer === undefined ? {} : { manufacturer: part.manufacturer }),
                ...(part.reference === undefined ? {} : { reference: part.reference }),
                quantity: part.quantity,
                unitPriceCents: cents(part.unitPriceEur),
              })),
              ...(input.workshop === undefined ? {} : { workshop: input.workshop }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "get_maintenance",
    {
      title: "Get maintenance",
      description: "Get a maintenance event and its parts",
      inputSchema: z.strictObject({ maintenanceEventId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.getMaintenance(maintenanceId(input.maintenanceEventId)),
        ),
      ),
  );

  server.registerTool(
    "list_maintenance",
    {
      title: "List maintenance",
      description: "List maintenance history, newest first",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.listMaintenance(vehicleId(input.vehicleId), page(input)),
        ),
      ),
  );

  server.registerTool(
    "update_maintenance",
    {
      title: "Update maintenance",
      description: "Update a maintenance event; supplying parts replaces its part list",
      inputSchema: z.strictObject({
        maintenanceEventId: uuid,
        title: text.optional(),
        category: z.enum(maintenanceCategories).optional(),
        performedAt: isoDate.optional(),
        mileageKm: mileage.optional(),
        laborCostEur: money.optional(),
        parts: z.array(partSchema).max(100).optional(),
        workshop: z.union([text, z.null()]).optional(),
        notes: z.union([z.string().trim().max(4_000), z.null()]).optional(),
      }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.updateMaintenance(
            maintenanceId(input.maintenanceEventId),
            {
              ...(input.title === undefined ? {} : { title: input.title }),
              ...(input.category === undefined ? {} : { category: input.category }),
              ...(input.performedAt === undefined ? {} : { performedAt: input.performedAt }),
              ...(input.mileageKm === undefined ? {} : { mileageKm: input.mileageKm }),
              ...(input.laborCostEur === undefined
                ? {}
                : { laborCostCents: cents(input.laborCostEur) }),
              ...(input.parts === undefined
                ? {}
                : {
                    parts: input.parts.map((part) => ({
                      name: part.name,
                      ...(part.manufacturer === undefined
                        ? {}
                        : { manufacturer: part.manufacturer }),
                      ...(part.reference === undefined ? {} : { reference: part.reference }),
                      quantity: part.quantity,
                      unitPriceCents: cents(part.unitPriceEur),
                    })),
                  }),
              ...(input.workshop === undefined ? {} : { workshop: input.workshop }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "delete_maintenance",
    {
      title: "Delete maintenance",
      description: "Delete maintenance and parts, retaining attached document records",
      inputSchema: z.strictObject({ maintenanceEventId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.deleteMaintenance(maintenanceId(input.maintenanceEventId)),
        ),
      ),
  );

  server.registerTool(
    "add_expense",
    {
      title: "Add expense",
      description: "Add a standalone expense; maintenance costs remain separate",
      inputSchema: z.strictObject(expenseInputSchema),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.addExpense(
            {
              vehicleId: vehicleId(input.vehicleId),
              category: input.category,
              description: input.description,
              amountCents: cents(input.amountEur),
              incurredAt: input.incurredAt,
              ...(input.mileageKm === undefined ? {} : { mileageKm: input.mileageKm }),
              ...(input.vendor === undefined ? {} : { vendor: input.vendor }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "list_expenses",
    {
      title: "List expenses",
      description: "List standalone expenses, newest first",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.listExpenses(vehicleId(input.vehicleId), page(input)),
        ),
      ),
  );

  server.registerTool(
    "update_expense",
    {
      title: "Update expense",
      description: "Update an expense; null clears an optional field",
      inputSchema: z.strictObject({
        expenseId: uuid,
        category: z.enum(expenseCategories).optional(),
        description: text.optional(),
        amountEur: money.optional(),
        incurredAt: isoDate.optional(),
        mileageKm: z.union([mileage, z.null()]).optional(),
        vendor: z.union([text, z.null()]).optional(),
        notes: z.union([z.string().trim().max(4_000), z.null()]).optional(),
      }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.updateExpense(
            expenseId(input.expenseId),
            {
              ...(input.category === undefined ? {} : { category: input.category }),
              ...(input.description === undefined ? {} : { description: input.description }),
              ...(input.amountEur === undefined ? {} : { amountCents: cents(input.amountEur) }),
              ...(input.incurredAt === undefined ? {} : { incurredAt: input.incurredAt }),
              ...(input.mileageKm === undefined ? {} : { mileageKm: input.mileageKm }),
              ...(input.vendor === undefined ? {} : { vendor: input.vendor }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "delete_expense",
    {
      title: "Delete expense",
      description: "Delete an expense while retaining attached document records",
      inputSchema: z.strictObject({ expenseId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) => repository.deleteExpense(expenseId(input.expenseId))),
      ),
  );

  server.registerTool(
    "add_reminder",
    {
      title: "Add reminder",
      description: "Add a date and/or mileage maintenance reminder",
      inputSchema: z
        .strictObject(reminderInputSchema)
        .refine(
          (input) => input.dueDate !== undefined || input.dueMileageKm !== undefined,
          "At least dueDate or dueMileageKm is required",
        )
        .refine(
          (input) => input.recurrenceMonths === undefined || input.dueDate !== undefined,
          "recurrenceMonths requires dueDate",
        )
        .refine(
          (input) => input.recurrenceKm === undefined || input.dueMileageKm !== undefined,
          "recurrenceKm requires dueMileageKm",
        ),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.addReminder(
            {
              vehicleId: vehicleId(input.vehicleId),
              title: input.title,
              category: input.category,
              ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
              ...(input.dueMileageKm === undefined ? {} : { dueMileageKm: input.dueMileageKm }),
              ...(input.recurrenceMonths === undefined
                ? {}
                : { recurrenceMonths: input.recurrenceMonths }),
              ...(input.recurrenceKm === undefined ? {} : { recurrenceKm: input.recurrenceKm }),
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          ),
        ),
      ),
  );

  server.registerTool(
    "list_reminders",
    {
      title: "List reminders",
      description: "List all reminders with computed status",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          Effect.all({
            records: repository.listReminders(vehicleId(input.vehicleId), page(input)),
            currentMileageKm: repository.getCurrentMileage(vehicleId(input.vehicleId)),
          }).pipe(
            Effect.map(({ records, currentMileageKm }) =>
              records.map((record) => ({
                ...record,
                status: reminderStatus(record, currentMileageKm, now),
              })),
            ),
          ),
        ),
      ),
  );

  server.registerTool(
    "list_due_reminders",
    {
      title: "List due reminders",
      description: "List reminders that are due or overdue",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          Effect.all({
            records: repository.listReminders(vehicleId(input.vehicleId), page(input)),
            currentMileageKm: repository.getCurrentMileage(vehicleId(input.vehicleId)),
          }).pipe(
            Effect.map(({ records, currentMileageKm }) =>
              records
                .map((record) => ({
                  ...record,
                  status: reminderStatus(record, currentMileageKm, now),
                }))
                .filter(({ status }) => status === "due" || status === "overdue"),
            ),
          ),
        ),
      ),
  );

  server.registerTool(
    "complete_reminder",
    {
      title: "Complete reminder",
      description: "Complete a reminder and atomically create its next recurrence",
      inputSchema: z.strictObject({ reminderId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.completeReminder(reminderId(input.reminderId), now),
        ),
      ),
  );

  server.registerTool(
    "attach_document",
    {
      title: "Attach document",
      description: "Record a validated local document path without copying the file",
      inputSchema: z
        .strictObject({
          vehicleId: uuid,
          maintenanceEventId: uuid.optional(),
          expenseId: uuid.optional(),
          type: text,
          title: text,
          localPath: z.string().min(1).max(2_000),
          mimeType: z.string().trim().min(1).max(200).optional(),
          recordedAt: isoDate,
          notes,
        })
        .refine(
          (input) => input.maintenanceEventId === undefined || input.expenseId === undefined,
          "A document can reference maintenance or an expense, not both",
        ),
    },
    (input) =>
      execute(
        runner,
        Effect.gen(function* () {
          const repository = yield* GarageRepository;
          const storage = yield* DocumentStorage;
          const clock = yield* AppClock;
          const resolvedPath = yield* storage.validate(input.localPath);
          const now = yield* clock.now;
          return yield* repository.attachDocument(
            {
              vehicleId: vehicleId(input.vehicleId),
              ...(input.maintenanceEventId === undefined
                ? {}
                : { maintenanceEventId: maintenanceId(input.maintenanceEventId) }),
              ...(input.expenseId === undefined ? {} : { expenseId: expenseId(input.expenseId) }),
              type: input.type,
              title: input.title,
              localPath: resolvedPath,
              ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
              recordedAt: input.recordedAt,
              ...(input.notes === undefined ? {} : { notes: input.notes }),
            },
            now,
          );
        }),
      ),
  );

  server.registerTool(
    "list_documents",
    {
      title: "List documents",
      description: "List document references, newest first",
      inputSchema: z.strictObject({ vehicleId: uuid, ...pageFields }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) =>
          repository.listDocuments(vehicleId(input.vehicleId), page(input)),
        ),
      ),
  );

  server.registerTool(
    "remove_document",
    {
      title: "Remove document",
      description: "Remove a document reference without deleting the local file",
      inputSchema: z.strictObject({ documentId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectRepository((repository) => repository.removeDocument(documentId(input.documentId))),
      ),
  );

  server.registerTool(
    "get_vehicle_summary",
    {
      title: "Get vehicle summary",
      description: "Get mileage, maintenance, reminders and separate cost totals",
      inputSchema: z.strictObject({ vehicleId: uuid }),
    },
    (input) =>
      execute(
        runner,
        effectNow((repository, now) =>
          repository.getVehicleSummary(vehicleId(input.vehicleId), now),
        ),
      ),
  );

  server.registerResource(
    "vehicles",
    "garage://vehicles",
    { title: "Vehicles", description: "All garage vehicles", mimeType: "application/json" },
    (uri) =>
      jsonResource(
        runner,
        uri,
        effectRepository((repository) => repository.listVehicles({ limit: 200, offset: 0 })),
      ),
  );

  const registerVehicleResource = (
    name: string,
    template: string,
    description: string,
    select: (
      repository: GarageRepository["Type"],
      id: ReturnType<typeof vehicleId>,
      now: string,
    ) => Effect.Effect<unknown, DomainError>,
  ) =>
    server.registerResource(
      name,
      new ResourceTemplate(template, { list: undefined }),
      { title: name, description, mimeType: "application/json" },
      (uri, parameters) => {
        const rawId = parameters["vehicleId"];
        const id = vehicleId(typeof rawId === "string" ? rawId : "");
        return jsonResource(
          runner,
          uri,
          effectNow((repository, now) => select(repository, id, now)),
        );
      },
    );

  registerVehicleResource(
    "vehicle",
    "garage://vehicles/{vehicleId}",
    "Vehicle details",
    (repository, id) => repository.getVehicle(id),
  );
  registerVehicleResource(
    "vehicle-maintenance",
    "garage://vehicles/{vehicleId}/maintenance",
    "Vehicle maintenance history",
    (repository, id) => repository.listMaintenance(id, { limit: 200, offset: 0 }),
  );
  registerVehicleResource(
    "vehicle-expenses",
    "garage://vehicles/{vehicleId}/expenses",
    "Vehicle expenses",
    (repository, id) => repository.listExpenses(id, { limit: 200, offset: 0 }),
  );
  registerVehicleResource(
    "vehicle-reminders",
    "garage://vehicles/{vehicleId}/reminders",
    "Vehicle reminders",
    (repository, id) => repository.listReminders(id, { limit: 200, offset: 0 }),
  );
  registerVehicleResource(
    "vehicle-summary",
    "garage://vehicles/{vehicleId}/summary",
    "Vehicle summary",
    (repository, id, now) => repository.getVehicleSummary(id, now),
  );

  return server;
};

export const validateText = nonEmpty;
export const validateMileage = isNonNegativeInteger;
