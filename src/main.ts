#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer, ManagedRuntime } from "effect";
import { loadConfig } from "./config/config.js";
import { LiveClockLayer } from "./infrastructure/clock/live-clock.js";
import { sqliteRepositoryLayer } from "./infrastructure/database/sqlite.js";
import { documentStorageLayer } from "./infrastructure/filesystem/document-storage.js";
import { createGarageServer } from "./mcp/server.js";

const writeLog = (
  level: "info" | "error",
  event: string,
  details: Readonly<Record<string, unknown>> = {},
) => {
  process.stderr.write(`${JSON.stringify({ level, event, ...details })}\n`);
};

const start = async (): Promise<void> => {
  const config = await Effect.runPromise(loadConfig());
  const applicationLayer = Layer.mergeAll(
    sqliteRepositoryLayer(config.dbPath),
    LiveClockLayer,
    documentStorageLayer(config.documentRoot),
  );
  const runtime = ManagedRuntime.make(applicationLayer);
  const server = createGarageServer({
    runPromise: (effect) => runtime.runPromise(effect),
  });
  const transport = new StdioServerTransport();
  let closing = false;
  const close = async (signal: string) => {
    if (closing) return;
    closing = true;
    writeLog("info", "shutdown", { signal });
    await server.close();
    await runtime.dispose();
  };
  process.once("SIGINT", () => {
    void close("SIGINT");
  });
  process.once("SIGTERM", () => {
    void close("SIGTERM");
  });
  await server.connect(transport);
  writeLog("info", "server_started", {
    transport: "stdio",
    database: config.dbPath === ":memory:" ? ":memory:" : "[redacted]",
  });
};

start().catch((error: unknown) => {
  writeLog("error", "startup_failed", {
    message: error instanceof Error ? error.message : "Unknown startup error",
  });
  process.exitCode = 1;
});
