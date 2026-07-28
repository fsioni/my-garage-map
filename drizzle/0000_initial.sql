PRAGMA foreign_keys = ON;
--> statement-breakpoint
CREATE TABLE `vehicles` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `make` text NOT NULL,
  `model` text NOT NULL,
  `registration_number` text,
  `vin` text,
  `first_registration_date` text,
  `purchase_date` text,
  `purchase_price_cents` integer,
  `currency` text DEFAULT 'EUR' NOT NULL,
  `initial_mileage_km` integer NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `vehicles_name_not_empty` CHECK(length(trim(`name`)) > 0),
  CONSTRAINT `vehicles_make_not_empty` CHECK(length(trim(`make`)) > 0),
  CONSTRAINT `vehicles_model_not_empty` CHECK(length(trim(`model`)) > 0),
  CONSTRAINT `vehicles_initial_mileage_nonnegative` CHECK(`initial_mileage_km` >= 0),
  CONSTRAINT `vehicles_purchase_price_nonnegative` CHECK(`purchase_price_cents` is null or `purchase_price_cents` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_registration_number_idx` ON `vehicles` (`registration_number`);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_vin_idx` ON `vehicles` (`vin`);
--> statement-breakpoint
CREATE TABLE `mileage_records` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE restrict,
  `mileage_km` integer NOT NULL,
  `recorded_at` text NOT NULL,
  `source` text NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  CONSTRAINT `mileage_records_mileage_nonnegative` CHECK(`mileage_km` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mileage_records_dedup_idx` ON `mileage_records` (`vehicle_id`,`mileage_km`,`recorded_at`,`source`);
--> statement-breakpoint
CREATE INDEX `mileage_records_vehicle_recorded_idx` ON `mileage_records` (`vehicle_id`,`recorded_at`);
--> statement-breakpoint
CREATE TABLE `maintenance_events` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE restrict,
  `title` text NOT NULL,
  `category` text NOT NULL,
  `performed_at` text NOT NULL,
  `mileage_km` integer NOT NULL,
  `labor_cost_cents` integer NOT NULL,
  `parts_cost_cents` integer NOT NULL,
  `total_cost_cents` integer NOT NULL,
  `workshop` text,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `maintenance_mileage_nonnegative` CHECK(`mileage_km` >= 0),
  CONSTRAINT `maintenance_labor_cost_nonnegative` CHECK(`labor_cost_cents` >= 0),
  CONSTRAINT `maintenance_parts_cost_nonnegative` CHECK(`parts_cost_cents` >= 0),
  CONSTRAINT `maintenance_total_consistent` CHECK(`total_cost_cents` = `labor_cost_cents` + `parts_cost_cents`)
);
--> statement-breakpoint
CREATE INDEX `maintenance_vehicle_performed_idx` ON `maintenance_events` (`vehicle_id`,`performed_at`);
--> statement-breakpoint
CREATE TABLE `parts` (
  `id` text PRIMARY KEY NOT NULL,
  `maintenance_event_id` text NOT NULL REFERENCES `maintenance_events`(`id`) ON DELETE restrict,
  `name` text NOT NULL,
  `manufacturer` text,
  `reference` text,
  `quantity` integer NOT NULL,
  `unit_price_cents` integer NOT NULL,
  `total_price_cents` integer NOT NULL,
  CONSTRAINT `parts_quantity_positive` CHECK(`quantity` > 0),
  CONSTRAINT `parts_unit_price_nonnegative` CHECK(`unit_price_cents` >= 0),
  CONSTRAINT `parts_total_consistent` CHECK(`total_price_cents` = `quantity` * `unit_price_cents`)
);
--> statement-breakpoint
CREATE INDEX `parts_maintenance_idx` ON `parts` (`maintenance_event_id`);
--> statement-breakpoint
CREATE TABLE `expenses` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE restrict,
  `category` text NOT NULL,
  `description` text NOT NULL,
  `amount_cents` integer NOT NULL,
  `incurred_at` text NOT NULL,
  `mileage_km` integer,
  `vendor` text,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `expenses_amount_nonnegative` CHECK(`amount_cents` >= 0),
  CONSTRAINT `expenses_mileage_nonnegative` CHECK(`mileage_km` is null or `mileage_km` >= 0)
);
--> statement-breakpoint
CREATE INDEX `expenses_vehicle_incurred_idx` ON `expenses` (`vehicle_id`,`incurred_at`);
--> statement-breakpoint
CREATE TABLE `reminders` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE restrict,
  `title` text NOT NULL,
  `category` text NOT NULL,
  `due_date` text,
  `due_mileage_km` integer,
  `recurrence_months` integer,
  `recurrence_km` integer,
  `completed_at` text,
  `notes` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `reminders_has_due` CHECK(`due_date` is not null or `due_mileage_km` is not null),
  CONSTRAINT `reminders_due_mileage_nonnegative` CHECK(`due_mileage_km` is null or `due_mileage_km` >= 0),
  CONSTRAINT `reminders_recurrence_months_positive` CHECK(`recurrence_months` is null or `recurrence_months` > 0),
  CONSTRAINT `reminders_recurrence_km_positive` CHECK(`recurrence_km` is null or `recurrence_km` > 0)
);
--> statement-breakpoint
CREATE INDEX `reminders_vehicle_idx` ON `reminders` (`vehicle_id`);
--> statement-breakpoint
CREATE TABLE `documents` (
  `id` text PRIMARY KEY NOT NULL,
  `vehicle_id` text NOT NULL REFERENCES `vehicles`(`id`) ON DELETE restrict,
  `maintenance_event_id` text REFERENCES `maintenance_events`(`id`) ON DELETE restrict,
  `expense_id` text REFERENCES `expenses`(`id`) ON DELETE restrict,
  `type` text NOT NULL,
  `title` text NOT NULL,
  `local_path` text NOT NULL,
  `mime_type` text,
  `recorded_at` text NOT NULL,
  `notes` text,
  `created_at` text NOT NULL,
  CONSTRAINT `documents_single_parent` CHECK(not (`maintenance_event_id` is not null and `expense_id` is not null))
);
--> statement-breakpoint
CREATE INDEX `documents_vehicle_idx` ON `documents` (`vehicle_id`);
--> statement-breakpoint
CREATE INDEX `documents_maintenance_idx` ON `documents` (`maintenance_event_id`);
--> statement-breakpoint
CREATE INDEX `documents_expense_idx` ON `documents` (`expense_id`);
