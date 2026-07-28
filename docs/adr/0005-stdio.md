# ADR 0005: MCP stdio transport

Status: accepted

Stdio is the MCP transport designed for local process-spawned servers. It avoids ports,
authentication, and an HTTP business API. Stdout is protocol-only; structured logs use stderr.

