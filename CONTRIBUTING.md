# Contributing

Thanks for helping improve Garage MCP. Contributions of code, tests, documentation, bug
reports, and design feedback are welcome.

By participating, you agree to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Before opening an issue

- Search existing issues to avoid duplicates.
- Use the bug, feature, or question form.
- Remove vehicle registrations, VINs, file paths, database contents, tokens, and other personal
  data from logs and examples.
- Do not report security vulnerabilities publicly. Follow [SECURITY.md](./SECURITY.md).

For a substantial feature or architectural change, open an issue before implementation so its
scope and fit can be discussed.

## Development setup

You need Node.js 24 and pnpm 10.30.1 or a compatible pnpm 10 release.

```bash
git clone https://github.com/fsioni/my-garage-map.git
cd my-garage-map
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
pnpm check
```

The default database path is local and ignored by Git. Use `GARAGE_DB_PATH=:memory:` for
experiments that should not persist.

## Project conventions

- Keep domain rules pure when they do not require I/O.
- Model expected failures with typed Effect errors.
- Keep adapters behind the ports in `src/application/ports.ts`.
- Preserve integer-cent money storage and monotonic mileage rules.
- Reserve stdout for MCP JSON-RPC; operational output belongs on stderr.
- Use strict schemas and reject unknown MCP input fields.
- Add or update tests with every behavior change.
- Use Biome for formatting and linting; do not hand-format around it.

Architectural decisions are documented in [ARCHITECTURE.md](./ARCHITECTURE.md) and
[`docs/adr`](./docs/adr). Add an ADR when a change alters a durable architectural constraint.

## Database changes

Update `src/infrastructure/database/schema.ts`, then generate and review a versioned migration:

```bash
pnpm db:generate
```

Never edit an already released migration. Include repository integration tests that run the real
migration against SQLite.

## Tests and quality gate

Useful focused commands:

```bash
pnpm test:unit
pnpm test:integration
pnpm test:contract
```

Before submitting a pull request, run:

```bash
pnpm check
pnpm audit --audit-level high
```

`pnpm check` verifies formatting, linting, strict TypeScript, the complete coverage suite, and
the production build. Global coverage thresholds are 90% for lines, statements, and functions,
and 85% for branches.

## Pull requests

- Keep each pull request focused on one coherent change.
- Explain the problem and the chosen solution.
- Link the related issue when one exists.
- Document user-visible behavior and configuration changes.
- Update `CHANGELOG.md` under `Unreleased`.
- Confirm that no personal garage data or generated artifacts are included.

Maintainers may ask for changes before merging. Squashing or rebasing can be requested to keep
the project history clear.
