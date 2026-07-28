# ADR 0002: Effect

Status: accepted

Effect models typed failures, service dependencies, scoped SQLite lifetime, configuration, and
test Layers. Pure deterministic transformations stay as plain functions. This keeps Effect
meaningful at boundaries and workflows instead of using it as decoration.

