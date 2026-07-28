# ADR 0001: SQLite

Status: accepted

SQLite fits a local, single-user server, produces one backup-friendly file, supports foreign
keys and transactions, and needs no daemon. Drizzle supplies typed queries and versioned
migrations. A client/server database would add operations and configuration without a V1 need.

