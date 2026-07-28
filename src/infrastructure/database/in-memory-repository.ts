import { Effect, Layer } from "effect";
import { GarageRepository, type GarageRepositoryService } from "../../application/ports.js";
import {
  DocumentNotFound,
  ExpenseNotFound,
  InvalidMileage,
  MaintenanceEventNotFound,
  MileageRegression,
  ReminderNotFound,
  VehicleNotFound,
} from "../../domain/errors.js";
import type { DomainError } from "../../domain/errors.js";
import {
  createId,
  DocumentIdSchema,
  type Document,
  ExpenseIdSchema,
  type Expense,
  MaintenanceEventIdSchema,
  type MaintenanceEvent,
  MileageRecordIdSchema,
  type MileageRecord,
  PartIdSchema,
  type Reminder,
  ReminderIdSchema,
  type Vehicle,
  VehicleIdSchema,
  type VehicleSummary,
} from "../../domain/models.js";
import {
  aggregateCosts,
  costPerKm,
  maintenanceTotal,
  nextReminderOccurrence,
  partTotal,
  reminderStatus,
} from "../../domain/rules.js";

const paginate = <A>(items: readonly A[], limit: number, offset: number): readonly A[] =>
  items.slice(offset, offset + limit);

export const makeInMemoryGarageRepository = (): GarageRepositoryService => {
  let vehicleRecords: Vehicle[] = [];
  let mileageRecordList: MileageRecord[] = [];
  let maintenanceRecordList: MaintenanceEvent[] = [];
  let expenseRecordList: Expense[] = [];
  let reminderRecordList: Reminder[] = [];
  let documentRecordList: Document[] = [];

  const vehicle = (id: string): Effect.Effect<Vehicle, DomainError> => {
    const found = vehicleRecords.find((record) => record.id === id);
    return found === undefined
      ? Effect.fail(new VehicleNotFound({ vehicleId: id }))
      : Effect.succeed(found);
  };
  const currentMileage = (id: string): Effect.Effect<number, DomainError> =>
    vehicle(id).pipe(
      Effect.map((found) => {
        const latest = mileageRecordList
          .filter((record) => record.vehicleId === id)
          .toSorted(
            (left, right) =>
              right.recordedAt.localeCompare(left.recordedAt) ||
              right.createdAt.localeCompare(left.createdAt) ||
              right.id.localeCompare(left.id),
          )[0];
        return latest?.mileageKm ?? found.initialMileageKm;
      }),
    );
  const maintenance = (id: string): Effect.Effect<MaintenanceEvent, DomainError> => {
    const found = maintenanceRecordList.find((record) => record.id === id);
    return found === undefined
      ? Effect.fail(new MaintenanceEventNotFound({ maintenanceEventId: id }))
      : Effect.succeed(found);
  };
  const expense = (id: string): Effect.Effect<Expense, DomainError> => {
    const found = expenseRecordList.find((record) => record.id === id);
    return found === undefined
      ? Effect.fail(new ExpenseNotFound({ expenseId: id }))
      : Effect.succeed(found);
  };
  const reminder = (id: string): Effect.Effect<Reminder, DomainError> => {
    const found = reminderRecordList.find((record) => record.id === id);
    return found === undefined
      ? Effect.fail(new ReminderNotFound({ reminderId: id }))
      : Effect.succeed(found);
  };

  return {
    createVehicle: (input, now) =>
      Effect.sync(() => {
        const created: Vehicle = {
          id: createId(VehicleIdSchema),
          name: input.name.trim(),
          make: input.make.trim(),
          model: input.model.trim(),
          ...(input.registrationNumber === undefined
            ? {}
            : { registrationNumber: input.registrationNumber }),
          ...(input.vin === undefined ? {} : { vin: input.vin }),
          ...(input.firstRegistrationDate === undefined
            ? {}
            : { firstRegistrationDate: input.firstRegistrationDate }),
          ...(input.purchaseDate === undefined ? {} : { purchaseDate: input.purchaseDate }),
          ...(input.purchasePriceCents === undefined
            ? {}
            : { purchasePriceCents: input.purchasePriceCents }),
          currency: input.currency ?? "EUR",
          initialMileageKm: input.initialMileageKm,
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          createdAt: now,
          updatedAt: now,
        };
        vehicleRecords = [...vehicleRecords, created];
        return created;
      }),
    listVehicles: ({ limit, offset }) =>
      Effect.succeed(
        paginate(
          vehicleRecords.toSorted(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          ),
          limit,
          offset,
        ),
      ),
    getVehicle: vehicle,
    updateVehicle: (id, input, now) =>
      vehicle(id).pipe(
        Effect.map((existing) => {
          const updated: Vehicle = {
            ...existing,
            ...(input.name === undefined ? {} : { name: input.name }),
            ...(input.make === undefined ? {} : { make: input.make }),
            ...(input.model === undefined ? {} : { model: input.model }),
            ...(input.registrationNumber === undefined
              ? {}
              : input.registrationNumber === null
                ? { registrationNumber: undefined }
                : { registrationNumber: input.registrationNumber }),
            ...(input.vin === undefined
              ? {}
              : input.vin === null
                ? { vin: undefined }
                : { vin: input.vin }),
            ...(input.firstRegistrationDate === undefined
              ? {}
              : input.firstRegistrationDate === null
                ? { firstRegistrationDate: undefined }
                : { firstRegistrationDate: input.firstRegistrationDate }),
            ...(input.purchaseDate === undefined
              ? {}
              : input.purchaseDate === null
                ? { purchaseDate: undefined }
                : { purchaseDate: input.purchaseDate }),
            ...(input.purchasePriceCents === undefined
              ? {}
              : input.purchasePriceCents === null
                ? { purchasePriceCents: undefined }
                : { purchasePriceCents: input.purchasePriceCents }),
            ...(input.currency === undefined ? {} : { currency: input.currency }),
            ...(input.notes === undefined
              ? {}
              : input.notes === null
                ? { notes: undefined }
                : { notes: input.notes }),
            updatedAt: now,
          };
          vehicleRecords = vehicleRecords.map((record) => (record.id === id ? updated : record));
          return updated;
        }),
      ),
    recordMileage: (input, now) =>
      currentMileage(input.vehicleId).pipe(
        Effect.flatMap((current): Effect.Effect<MileageRecord, DomainError> => {
          if (input.mileageKm < current) {
            return Effect.fail(new MileageRegression({ attempted: input.mileageKm, current }));
          }
          const duplicate = mileageRecordList.some(
            (record) =>
              record.vehicleId === input.vehicleId &&
              record.mileageKm === input.mileageKm &&
              record.recordedAt === input.recordedAt &&
              record.source === input.source,
          );
          if (duplicate) {
            return Effect.fail(
              new InvalidMileage({ reason: "An identical mileage record already exists" }),
            );
          }
          const created: MileageRecord = {
            id: createId(MileageRecordIdSchema),
            ...input,
            createdAt: now,
          };
          mileageRecordList = [...mileageRecordList, created];
          return Effect.succeed(created);
        }),
      ),
    getCurrentMileage: currentMileage,
    listMileageRecords: (vehicleId, { limit, offset }) =>
      vehicle(vehicleId).pipe(
        Effect.map(() =>
          paginate(
            mileageRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .toSorted(
                (left, right) =>
                  right.recordedAt.localeCompare(left.recordedAt) ||
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              ),
            limit,
            offset,
          ),
        ),
      ),
    addMaintenance: (input, now) =>
      currentMileage(input.vehicleId).pipe(
        Effect.flatMap((current) => {
          if (input.mileageKm < current) {
            return Effect.fail(new MileageRegression({ attempted: input.mileageKm, current }));
          }
          const id = createId(MaintenanceEventIdSchema);
          const eventParts = input.parts.map((item) => ({
            id: createId(PartIdSchema),
            maintenanceEventId: id,
            name: item.name,
            ...(item.manufacturer === undefined ? {} : { manufacturer: item.manufacturer }),
            ...(item.reference === undefined ? {} : { reference: item.reference }),
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            totalPriceCents: partTotal(item.quantity, item.unitPriceCents),
          }));
          const partsCostCents = eventParts.reduce(
            (total, item) => total + item.totalPriceCents,
            0,
          );
          const created: MaintenanceEvent = {
            id,
            vehicleId: input.vehicleId,
            title: input.title,
            category: input.category,
            performedAt: input.performedAt,
            mileageKm: input.mileageKm,
            laborCostCents: input.laborCostCents,
            partsCostCents,
            totalCostCents: maintenanceTotal(input.laborCostCents, partsCostCents),
            ...(input.workshop === undefined ? {} : { workshop: input.workshop }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            parts: eventParts,
            createdAt: now,
            updatedAt: now,
          };
          maintenanceRecordList = [...maintenanceRecordList, created];
          if (input.mileageKm > current) {
            mileageRecordList = [
              ...mileageRecordList,
              {
                id: createId(MileageRecordIdSchema),
                vehicleId: input.vehicleId,
                mileageKm: input.mileageKm,
                recordedAt: input.performedAt,
                source: "maintenance",
                createdAt: now,
              },
            ];
          }
          return Effect.succeed(created);
        }),
      ),
    getMaintenance: maintenance,
    listMaintenance: (vehicleId, { limit, offset }) =>
      vehicle(vehicleId).pipe(
        Effect.map(() =>
          paginate(
            maintenanceRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .toSorted(
                (left, right) =>
                  right.performedAt.localeCompare(left.performedAt) ||
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              ),
            limit,
            offset,
          ),
        ),
      ),
    updateMaintenance: (id, input, now) =>
      maintenance(id).pipe(
        Effect.map((existing) => {
          const nextParts =
            input.parts?.map((item) => ({
              id: createId(PartIdSchema),
              maintenanceEventId: existing.id,
              name: item.name,
              ...(item.manufacturer === undefined ? {} : { manufacturer: item.manufacturer }),
              ...(item.reference === undefined ? {} : { reference: item.reference }),
              quantity: item.quantity,
              unitPriceCents: item.unitPriceCents,
              totalPriceCents: partTotal(item.quantity, item.unitPriceCents),
            })) ?? existing.parts;
          const partsCostCents = nextParts.reduce((total, item) => total + item.totalPriceCents, 0);
          const laborCostCents = input.laborCostCents ?? existing.laborCostCents;
          const updated: MaintenanceEvent = {
            ...existing,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.performedAt === undefined ? {} : { performedAt: input.performedAt }),
            ...(input.mileageKm === undefined ? {} : { mileageKm: input.mileageKm }),
            laborCostCents,
            partsCostCents,
            totalCostCents: maintenanceTotal(laborCostCents, partsCostCents),
            ...(input.workshop === undefined
              ? {}
              : input.workshop === null
                ? { workshop: undefined }
                : { workshop: input.workshop }),
            ...(input.notes === undefined
              ? {}
              : input.notes === null
                ? { notes: undefined }
                : { notes: input.notes }),
            parts: nextParts,
            updatedAt: now,
          };
          maintenanceRecordList = maintenanceRecordList.map((record) =>
            record.id === id ? updated : record,
          );
          return updated;
        }),
      ),
    deleteMaintenance: (id) =>
      maintenance(id).pipe(
        Effect.map(() => {
          maintenanceRecordList = maintenanceRecordList.filter((record) => record.id !== id);
          documentRecordList = documentRecordList.map((record) => {
            if (record.maintenanceEventId !== id) return record;
            const { maintenanceEventId: _removed, ...retained } = record;
            return retained;
          });
          return undefined;
        }),
      ),
    addExpense: (input, now) =>
      vehicle(input.vehicleId).pipe(
        Effect.map(() => {
          const created: Expense = {
            id: createId(ExpenseIdSchema),
            ...input,
            createdAt: now,
            updatedAt: now,
          };
          expenseRecordList = [...expenseRecordList, created];
          return created;
        }),
      ),
    listExpenses: (vehicleId, { limit, offset }) =>
      vehicle(vehicleId).pipe(
        Effect.map(() =>
          paginate(
            expenseRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .toSorted(
                (left, right) =>
                  right.incurredAt.localeCompare(left.incurredAt) ||
                  right.createdAt.localeCompare(left.createdAt) ||
                  right.id.localeCompare(left.id),
              ),
            limit,
            offset,
          ),
        ),
      ),
    updateExpense: (id, input, now) =>
      expense(id).pipe(
        Effect.map((existing) => {
          const updated: Expense = {
            ...existing,
            ...(input.category === undefined ? {} : { category: input.category }),
            ...(input.description === undefined ? {} : { description: input.description }),
            ...(input.amountCents === undefined ? {} : { amountCents: input.amountCents }),
            ...(input.incurredAt === undefined ? {} : { incurredAt: input.incurredAt }),
            ...(input.mileageKm === undefined
              ? {}
              : input.mileageKm === null
                ? { mileageKm: undefined }
                : { mileageKm: input.mileageKm }),
            ...(input.vendor === undefined
              ? {}
              : input.vendor === null
                ? { vendor: undefined }
                : { vendor: input.vendor }),
            ...(input.notes === undefined
              ? {}
              : input.notes === null
                ? { notes: undefined }
                : { notes: input.notes }),
            updatedAt: now,
          };
          expenseRecordList = expenseRecordList.map((record) =>
            record.id === id ? updated : record,
          );
          return updated;
        }),
      ),
    deleteExpense: (id) =>
      expense(id).pipe(
        Effect.map(() => {
          expenseRecordList = expenseRecordList.filter((record) => record.id !== id);
          documentRecordList = documentRecordList.map((record) => {
            if (record.expenseId !== id) return record;
            const { expenseId: _removed, ...retained } = record;
            return retained;
          });
          return undefined;
        }),
      ),
    addReminder: (input, now) =>
      vehicle(input.vehicleId).pipe(
        Effect.map(() => {
          const created: Reminder = {
            id: createId(ReminderIdSchema),
            ...input,
            createdAt: now,
            updatedAt: now,
          };
          reminderRecordList = [...reminderRecordList, created];
          return created;
        }),
      ),
    listReminders: (vehicleId, { limit, offset }) =>
      vehicle(vehicleId).pipe(
        Effect.map(() =>
          paginate(
            reminderRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .toSorted(
                (left, right) =>
                  (left.completedAt ?? "").localeCompare(right.completedAt ?? "") ||
                  (left.dueDate ?? "").localeCompare(right.dueDate ?? "") ||
                  left.id.localeCompare(right.id),
              ),
            limit,
            offset,
          ),
        ),
      ),
    completeReminder: (id, now) =>
      reminder(id).pipe(
        Effect.map((existing) => {
          const completed: Reminder = { ...existing, completedAt: now, updatedAt: now };
          reminderRecordList = reminderRecordList.map((record) =>
            record.id === id ? completed : record,
          );
          const occurrence = nextReminderOccurrence(existing);
          if (occurrence === null) return { completed, next: null };
          const next: Reminder = {
            id: createId(ReminderIdSchema),
            ...occurrence,
            createdAt: now,
            updatedAt: now,
          };
          reminderRecordList = [...reminderRecordList, next];
          return { completed, next };
        }),
      ),
    attachDocument: (input, now) =>
      vehicle(input.vehicleId).pipe(
        Effect.map(() => {
          const created: Document = {
            id: createId(DocumentIdSchema),
            ...input,
            createdAt: now,
          };
          documentRecordList = [...documentRecordList, created];
          return created;
        }),
      ),
    listDocuments: (vehicleId, { limit, offset }) =>
      vehicle(vehicleId).pipe(
        Effect.map(() =>
          paginate(
            documentRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .toSorted(
                (left, right) =>
                  right.recordedAt.localeCompare(left.recordedAt) ||
                  left.id.localeCompare(right.id),
              ),
            limit,
            offset,
          ),
        ),
      ),
    removeDocument: (id) => {
      const found = documentRecordList.find((record) => record.id === id);
      if (found === undefined) return Effect.fail(new DocumentNotFound({ documentId: id }));
      documentRecordList = documentRecordList.filter((record) => record.id !== id);
      return Effect.void;
    },
    getVehicleSummary: (vehicleId, now) =>
      Effect.all({
        foundVehicle: vehicle(vehicleId),
        currentMileageKm: currentMileage(vehicleId),
      }).pipe(
        Effect.map(({ foundVehicle, currentMileageKm }) => {
          const maintenanceItems = maintenanceRecordList
            .filter((record) => record.vehicleId === vehicleId)
            .toSorted(
              (left, right) =>
                right.performedAt.localeCompare(left.performedAt) ||
                right.createdAt.localeCompare(left.createdAt) ||
                right.id.localeCompare(left.id),
            );
          const expenseItems = expenseRecordList.filter((record) => record.vehicleId === vehicleId);
          const totalExpensesCents = expenseItems.reduce(
            (total, item) => total + item.amountCents,
            0,
          );
          const totalMaintenanceCents = maintenanceItems.reduce(
            (total, item) => total + item.totalCostCents,
            0,
          );
          const totalRecordedCostCents = totalExpensesCents + totalMaintenanceCents;
          const last = maintenanceItems[0];
          return {
            vehicle: foundVehicle,
            currentMileageKm,
            lastMaintenance:
              last === undefined
                ? null
                : { performedAt: last.performedAt, mileageKm: last.mileageKm },
            recentMaintenance: maintenanceItems.slice(0, 5),
            reminders: reminderRecordList
              .filter((record) => record.vehicleId === vehicleId)
              .map((record) => ({
                ...record,
                status: reminderStatus(record, currentMileageKm, now),
              }))
              .filter(({ status }) => status === "due" || status === "overdue"),
            totalExpensesCents,
            totalMaintenanceCents,
            totalRecordedCostCents,
            costPerKmCents: costPerKm(
              totalRecordedCostCents,
              currentMileageKm,
              foundVehicle.initialMileageKm,
            ),
            costByCategory: aggregateCosts(maintenanceItems, expenseItems),
          } satisfies VehicleSummary;
        }),
      ),
  };
};

export const InMemoryGarageRepositoryLayer = Layer.sync(
  GarageRepository,
  makeInMemoryGarageRepository,
);
