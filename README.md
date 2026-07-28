# garage-mcp

`garage-mcp` is a local, single-user Model Context Protocol server for keeping the history
of several personal vehicles. It stores mileage, maintenance and parts, standalone expenses,
local document references, reminders, and cost summaries in SQLite.

The application has no web interface, HTTP business API, authentication, cloud storage,
telemetry, LLM call, OBD integration, or notification service. Its only application entry point
is MCP over stdio.

## Requirements

- Node.js 24 LTS
- pnpm 10 or newer
- a local MCP client that supports stdio

The project pins its package manager and all direct dependency versions. Node 24 is enforced
through `engines` and `.node-version`.

## Install and run

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate
pnpm build
pnpm start
```

For development:

```bash
pnpm dev
```

The server reserves stdout for JSON-RPC. Structured operational logs go to stderr only.
The database directory and schema are created at startup, so running `db:migrate` separately
is explicit but not required.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `GARAGE_DB_PATH` | `./data/garage.sqlite` | SQLite file, or `:memory:` in tests |
| `GARAGE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `GARAGE_DOCUMENT_ROOT` | unset | Optional root allowed for document paths |

When `GARAGE_DOCUMENT_ROOT` is set, attached paths are resolved and rejected if they escape
that root, including `..` traversal. Files are not copied and do not need to exist in V1.

## MCP client configuration

Build the project, then add an entry like this to a local MCP client's configuration. Replace
the path with the absolute checkout path.

```json
{
  "mcpServers": {
    "garage": {
      "command": "node",
      "args": ["/absolute/path/to/my-garage-map/dist/main.js"],
      "env": {
        "GARAGE_DB_PATH": "/absolute/path/to/my-garage-map/data/garage.sqlite",
        "GARAGE_DOCUMENT_ROOT": "/absolute/path/to/vehicle-documents"
      }
    }
  }
}
```

Restart the client after changing its MCP configuration. The Node executable selected by the
client must be Node 24.

## Tools

All list tools have stable sorting and accept `limit` (default 50, maximum 200) and `offset`.
Input objects are strict and reject unknown fields.

| Area | Tools |
| --- | --- |
| Vehicles | `create_vehicle`, `list_vehicles`, `get_vehicle`, `update_vehicle` |
| Mileage | `record_mileage`, `get_current_mileage`, `list_mileage_records` |
| Maintenance | `add_maintenance`, `get_maintenance`, `list_maintenance`, `update_maintenance`, `delete_maintenance` |
| Expenses | `add_expense`, `list_expenses`, `update_expense`, `delete_expense` |
| Reminders | `add_reminder`, `list_due_reminders`, `list_reminders`, `complete_reminder` |
| Documents | `attach_document`, `list_documents`, `remove_document` |
| Summary | `get_vehicle_summary` |

Monetary inputs use euro strings such as `"12"`, `"12.5"`, or `"12.50"`. Values such as
`"12.345"`, `"-3"`, and `"12,50"` are rejected. Values are converted to integer cents without
using binary floating-point arithmetic.

Example requests in natural language:

- “Add my 2013 Peugeot 2008 at 185,146 km.”
- “Record 186,020 km today for the Peugeot.”
- “Add an oil service at 186,020 km: €45 labor and one €62.50 oil kit.”
- “Remind me to inspect the brakes at 190,000 km.”
- “Attach `/Users/me/Documents/car/oil-invoice.pdf` to the last service.”
- “Show the Peugeot's cost summary.”

## Resources

Resources are read-only UTF-8 JSON:

- `garage://vehicles`
- `garage://vehicles/{vehicleId}`
- `garage://vehicles/{vehicleId}/maintenance`
- `garage://vehicles/{vehicleId}/expenses`
- `garage://vehicles/{vehicleId}/reminders`
- `garage://vehicles/{vehicleId}/summary`

## Data model and behavior

- `Vehicle` owns mileage, maintenance, expenses, reminders, and documents.
- Maintenance owns parts. Part and maintenance totals are calculated from integer cents.
- Adding maintenance above current mileage atomically adds a mileage record.
- Current mileage is the record newest by recorded date and then creation timestamp.
- Equal mileage is allowed when its date or source differs. A fully identical record is rejected
  by a database uniqueness constraint.
- A reminder is `due` in the 30 days or 1,000 km before either threshold, `overdue` after a
  threshold, `upcoming` otherwise, and `completed` when completed.
- Completing a recurring reminder preserves it and atomically creates a successor. Its date is
  advanced from the previous due date by the recurrence in calendar months (end-of-month
  clamped); mileage is advanced from the previous due mileage.
- Maintenance costs never create an expense row. Summaries report maintenance, standalone
  expenses, their combined total, and category breakdown separately to prevent double counting.
- Deleting maintenance or an expense explicitly detaches its document records. It never deletes
  files or relies on an implicit cascading delete.

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/adr](./docs/adr) for design details.

## Migrations and seed

Versioned SQL migrations live in `drizzle/`.

```bash
pnpm db:generate
pnpm db:migrate
```

The optional seed creates a Peugeot 2008 1.6 e-HDi Allure (2013), an initial 185,146 km,
purchase and transport expense placeholders, and a brake reminder:

```bash
pnpm seed
```

The seed refuses to run if the target database already contains a vehicle.

## Tests and quality

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:contract
pnpm test:coverage
pnpm check
```

Unit tests include property tests for money round trips, mileage monotonicity, and cost
aggregation. Integration tests use real SQLite `:memory:` databases and real migrations,
foreign keys, transactions, rollback, repositories, summaries, and document persistence.
Contract tests connect an official SDK `Client` to the server through an in-memory transport,
validate discovery and strict schemas, exercise errors and resources, and run a complete
vehicle scenario.

Coverage gates instrument the critical pure domain and error-presentation modules: lines,
statements, and functions must be at least 90%, branches at least 85%. The integration and MCP
adapters are tested behaviorally rather than included in that narrow instrumentation gate.

`pnpm check` runs format checking, lint, strict TypeScript, coverage tests, and the production
build. CI runs that command on every push and pull request.

## Backup

Stop the MCP client first so SQLite has no active writer, then copy the database file:

```bash
cp ./data/garage.sqlite ./backups/garage-$(date +%Y-%m-%d).sqlite
```

If copying while the server is running is unavoidable, use SQLite's online backup command
instead of copying only the main file:

```bash
sqlite3 ./data/garage.sqlite ".backup './backups/garage.sqlite'"
```

Restore only while the server is stopped, and keep an additional copy of the replaced file.

## V1 limits

- single local user and one process writing the database;
- no vehicle deletion tool;
- no document copying, file-existence check, or file deletion;
- offset pagination rather than cursor pagination;
- monetary tool inputs are denominated in euros; stored vehicle currency defaults to EUR;
- no automatic notifications or background scheduler.

