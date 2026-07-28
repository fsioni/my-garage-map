import path from "node:path";
import type { Expense, MaintenanceEvent, Part, Reminder, ReminderStatus } from "./models.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const MONEY = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

export const nonEmpty = (value: string): boolean => value.trim().length > 0;
export const normalizeVin = (vin: string | undefined): string | undefined => {
  const normalized = vin?.trim().toUpperCase();
  return normalized === "" ? undefined : normalized;
};
export const isIsoDate = (value: string): boolean => {
  if (ISO_DATE.test(value)) {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }
  if (!ISO_DATE_TIME.test(value) || Number.isNaN(Date.parse(value))) return false;
  const canonical = value.length === 20 ? `${value.slice(0, -1)}.000Z` : value;
  return new Date(value).toISOString() === canonical;
};
export const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

export const parseMoney = (value: string): number | null => {
  const match = MONEY.exec(value);
  if (match === null) return null;
  const [euros = "0", decimals = ""] = value.split(".");
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};

export const formatMoney = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

export const partTotal = (quantity: number, unitPriceCents: number): number =>
  quantity * unitPriceCents;
export const maintenanceTotal = (laborCostCents: number, partsCostCents: number): number =>
  laborCostCents + partsCostCents;
export const acceptsMileage = (current: number, candidate: number): boolean =>
  isNonNegativeInteger(candidate) && candidate >= current;

const dateOnly = (iso: string): number => Date.parse(iso.slice(0, 10));
const DAY_MS = 86_400_000;

export const reminderStatus = (
  reminder: Reminder,
  currentMileageKm: number,
  now: string,
): ReminderStatus => {
  if (reminder.completedAt !== undefined) return "completed";
  const today = dateOnly(now);
  const dueAt = reminder.dueDate === undefined ? undefined : dateOnly(reminder.dueDate);
  const dateOverdue = dueAt !== undefined && today > dueAt;
  const mileageOverdue =
    reminder.dueMileageKm !== undefined && currentMileageKm > reminder.dueMileageKm;
  if (dateOverdue || mileageOverdue) return "overdue";
  const dateDue = dueAt !== undefined && today >= dueAt - 30 * DAY_MS;
  const mileageDue =
    reminder.dueMileageKm !== undefined && currentMileageKm >= reminder.dueMileageKm - 1_000;
  return dateDue || mileageDue ? "due" : "upcoming";
};

const addUtcMonths = (iso: string, months: number): string => {
  const source = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const day = source.getUTCDate();
  source.setUTCDate(1);
  source.setUTCMonth(source.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + 1, 0),
  ).getUTCDate();
  source.setUTCDate(Math.min(day, lastDay));
  return source.toISOString().slice(0, 10);
};

export const nextReminderOccurrence = (
  reminder: Reminder,
): Omit<Reminder, "id" | "completedAt" | "createdAt" | "updatedAt"> | null => {
  if (reminder.recurrenceMonths === undefined && reminder.recurrenceKm === undefined) return null;
  return {
    vehicleId: reminder.vehicleId,
    title: reminder.title,
    category: reminder.category,
    ...(reminder.dueDate !== undefined && reminder.recurrenceMonths !== undefined
      ? { dueDate: addUtcMonths(reminder.dueDate, reminder.recurrenceMonths) }
      : {}),
    ...(reminder.dueMileageKm !== undefined && reminder.recurrenceKm !== undefined
      ? { dueMileageKm: reminder.dueMileageKm + reminder.recurrenceKm }
      : {}),
    ...(reminder.recurrenceMonths === undefined
      ? {}
      : { recurrenceMonths: reminder.recurrenceMonths }),
    ...(reminder.recurrenceKm === undefined ? {} : { recurrenceKm: reminder.recurrenceKm }),
    ...(reminder.notes === undefined ? {} : { notes: reminder.notes }),
  };
};

export const costPerKm = (
  totalCostCents: number,
  currentMileageKm: number,
  purchaseMileageKm: number,
): number | null => {
  const distance = currentMileageKm - purchaseMileageKm;
  return distance > 0 ? totalCostCents / distance : null;
};

export const aggregateCosts = (
  maintenance: readonly MaintenanceEvent[],
  expenses: readonly Expense[],
): Readonly<Record<string, number>> => {
  const result: Record<string, number> = {};
  for (const item of maintenance) {
    const key = `maintenance:${item.category}`;
    result[key] = (result[key] ?? 0) + item.totalCostCents;
  }
  for (const item of expenses) {
    const key = `expense:${item.category}`;
    result[key] = (result[key] ?? 0) + item.amountCents;
  }
  return Object.fromEntries(
    Object.entries(result).sort(([left], [right]) => left.localeCompare(right)),
  );
};

export const validateDocumentPath = (localPath: string, root?: string): string | null => {
  const resolved = path.resolve(localPath);
  if (root === undefined) return resolved;
  const resolvedRoot = path.resolve(root);
  const relative = path.relative(resolvedRoot, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    ? resolved
    : null;
};

export const sumPartTotals = (parts: readonly Pick<Part, "totalPriceCents">[]): number =>
  parts.reduce((total, part) => total + part.totalPriceCents, 0);
