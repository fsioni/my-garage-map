import { Effect } from "effect";
import { loadConfig } from "../../config/config.js";
import { migrateDatabase } from "./sqlite.js";

const config = await Effect.runPromise(loadConfig());
migrateDatabase(config.dbPath);
process.stderr.write(`${JSON.stringify({ level: "info", event: "migrations_applied" })}\n`);
