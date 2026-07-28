import path from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { AppClock, DocumentStorage } from "../../src/application/ports.js";
import { loadConfig } from "../../src/config/config.js";
import { fixedClockLayer, LiveClockLayer } from "../../src/infrastructure/clock/live-clock.js";
import { documentStorageLayer } from "../../src/infrastructure/filesystem/document-storage.js";

describe("configuration decoding", () => {
  it("uses documented defaults", async () => {
    const config = await Effect.runPromise(loadConfig({}));
    expect(config).toMatchObject({ logLevel: "info" });
    expect(config.dbPath).toBe(path.resolve("./data/garage.sqlite"));
    expect(config.documentRoot).toBeUndefined();
  });

  it.each(["debug", "info", "warn", "error"] as const)("accepts log level %s", async (logLevel) => {
    const config = await Effect.runPromise(loadConfig({ GARAGE_LOG_LEVEL: logLevel }));
    expect(config.logLevel).toBe(logLevel);
  });

  it("preserves the in-memory database sentinel", async () => {
    const config = await Effect.runPromise(loadConfig({ GARAGE_DB_PATH: ":memory:" }));
    expect(config.dbPath).toBe(":memory:");
  });

  it("resolves a relative database path", async () => {
    const config = await Effect.runPromise(
      loadConfig({ GARAGE_DB_PATH: "./custom/garage.sqlite" }),
    );
    expect(config.dbPath).toBe(path.resolve("./custom/garage.sqlite"));
  });

  it("resolves the document root", async () => {
    const config = await Effect.runPromise(loadConfig({ GARAGE_DOCUMENT_ROOT: "./documents" }));
    expect(config.documentRoot).toBe(path.resolve("./documents"));
  });

  it.each(["verbose", "INFO", "", "trace"])("rejects invalid log level %s", async (logLevel) => {
    const result = await Effect.runPromise(
      Effect.either(loadConfig({ GARAGE_LOG_LEVEL: logLevel })),
    );
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "ConfigurationError" },
    });
  });
});

describe("clock adapters", () => {
  it("returns the configured fixed instant every time", async () => {
    const layer = fixedClockLayer("2030-01-01T00:00:00.000Z");
    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* AppClock;
        return [yield* clock.now, yield* clock.now];
      }).pipe(Effect.provide(layer)),
    );
    expect(values).toEqual(["2030-01-01T00:00:00.000Z", "2030-01-01T00:00:00.000Z"]);
  });

  it("returns a valid current ISO instant in the live adapter", async () => {
    const value = await Effect.runPromise(
      Effect.gen(function* () {
        const clock = yield* AppClock;
        return yield* clock.now;
      }).pipe(Effect.provide(LiveClockLayer)),
    );
    expect(Number.isNaN(Date.parse(value))).toBe(false);
  });
});

describe("document storage adapter", () => {
  it("resolves paths when no root is configured", async () => {
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* DocumentStorage;
        return yield* storage.validate("./invoice.pdf");
      }).pipe(Effect.provide(documentStorageLayer())),
    );
    expect(resolved).toBe(path.resolve("./invoice.pdf"));
  });

  it("accepts a path inside the configured root", async () => {
    const resolved = await Effect.runPromise(
      Effect.gen(function* () {
        const storage = yield* DocumentStorage;
        return yield* storage.validate("/garage/docs/invoice.pdf");
      }).pipe(Effect.provide(documentStorageLayer("/garage/docs"))),
    );
    expect(resolved).toBe("/garage/docs/invoice.pdf");
  });

  it.each(["/garage/invoice.pdf", "/garage/docs/../invoice.pdf", "/tmp/invoice.pdf"])(
    "rejects path outside configured root %s",
    async (localPath) => {
      const result = await Effect.runPromise(
        Effect.either(
          Effect.gen(function* () {
            const storage = yield* DocumentStorage;
            return yield* storage.validate(localPath);
          }).pipe(Effect.provide(documentStorageLayer("/garage/docs"))),
        ),
      );
      expect(result).toMatchObject({
        _tag: "Left",
        left: { _tag: "ValidationError" },
      });
    },
  );
});
