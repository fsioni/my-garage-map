# Architecture

## Boundaries

The project uses a small ports-and-adapters design:

```text
MCP stdio -> MCP schemas/presenters -> application ports -> domain rules
                                      -> SQLite or memory adapter
                                      -> clock and document-path adapters
```

- `domain` contains immutable records, branded UUID schemas, typed errors, and pure rules.
- `application` defines the repository, clock, and document-storage ports and use-case inputs.
- `infrastructure` implements SQLite/Drizzle, the in-memory repository, clock, and path policy.
- `mcp` owns SDK-specific Zod schemas, tool/resource registration, and safe presentation.
- `config` decodes the process environment with Effect Config and Effect Schema.
- `main` composes scoped Layers and connects only a stdio transport.

Dependencies point inward. Domain modules do not import MCP, Drizzle, or the filesystem.

## Effect

Effect represents expected errors and service requirements in types. `Context.Tag` ports make
repositories, clock, and document policy replaceable. Layers compose live and test
implementations. SQLite is acquired with `Effect.acquireRelease`, so database closure follows
the runtime scope. MCP callbacks execute Effects through one managed runtime.

Validation, normalization, calculation, sorting, recurrence, money conversion, and aggregation
remain ordinary pure functions. Wrapping them in Effect would add no lifecycle, dependency, or
error-channel value.

## Persistence and transactions

Drizzle schema definitions and versioned SQL migrations describe the same SQLite model.
Foreign keys are enabled on every connection. Foreign-key deletes use `restrict`; application
transactions explicitly detach documents and delete owned parts.

Two multi-record workflows are atomic:

1. maintenance, parts, and the optional mileage record;
2. reminder completion and its recurring successor.

Synchronous `better-sqlite3` transactions prevent another statement from observing partial
state. Infrastructure failures are mapped to `DatabaseError` without exposing SQLite text.

## Money and time

Money is stored as safe integer cents. MCP accepts strict decimal strings and parses digits
directly, avoiding floating-point rounding. Maintenance and part totals are derived and also
protected by SQL checks.

Calendar dates are ISO 8601 strings. Creation/update instants are UTC ISO timestamps supplied
by the injected clock. Lexicographic ordering is therefore deterministic for the supported
formats.

## Errors

The domain uses discriminated Effect errors such as `VehicleNotFound`, `MileageRegression`,
and `DatabaseError`. MCP maps known errors to concise `{code, message}` values and returns
`isError: true`. Defects become a generic `InternalError`; stack traces, SQL, database paths,
and caught exception messages are not serialized.

## Testing

- pure rules and presenters: example tables and property tests;
- use cases: replaceable in-memory repository and fixed clock;
- persistence: real migrated SQLite in memory, without a Drizzle mock;
- protocol: official MCP client/server linked through in-memory transports.

