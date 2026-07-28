import path from "node:path";
import { Config, ConfigProvider, Effect, Schema } from "effect";
import { ConfigurationError } from "../domain/errors.js";

const LogLevelSchema = Schema.Literal("debug", "info", "warn", "error");
export type LogLevel = typeof LogLevelSchema.Type;

export interface AppConfig {
  readonly dbPath: string;
  readonly logLevel: LogLevel;
  readonly documentRoot?: string;
}

const rawConfig = Config.all({
  dbPath: Config.string("GARAGE_DB_PATH").pipe(Config.withDefault("./data/garage.sqlite")),
  logLevel: Config.string("GARAGE_LOG_LEVEL").pipe(Config.withDefault("info")),
  documentRoot: Config.option(Config.string("GARAGE_DOCUMENT_ROOT")),
});

export const loadConfig = (
  environment: Readonly<Record<string, string | undefined>> = process.env,
) =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromMap(
      new Map(
        Object.entries(environment).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, value]],
        ),
      ),
    );
    const raw = yield* rawConfig.pipe(
      Effect.withConfigProvider(provider),
      Effect.mapError(
        () => new ConfigurationError({ message: "Unable to read application configuration" }),
      ),
    );
    const logLevel = yield* Schema.decodeUnknown(LogLevelSchema)(raw.logLevel).pipe(
      Effect.mapError(
        () =>
          new ConfigurationError({
            message: "GARAGE_LOG_LEVEL must be debug, info, warn, or error",
          }),
      ),
    );
    return {
      dbPath: raw.dbPath === ":memory:" ? raw.dbPath : path.resolve(raw.dbPath),
      logLevel,
      ...(raw.documentRoot._tag === "None"
        ? {}
        : { documentRoot: path.resolve(raw.documentRoot.value) }),
    } satisfies AppConfig;
  });

export class AppConfigService extends Effect.Service<AppConfigService>()("garage/AppConfig", {
  effect: loadConfig(),
}) {}

export const appConfigLayer = AppConfigService.Default;
