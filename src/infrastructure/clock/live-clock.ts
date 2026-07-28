import { Effect, Layer } from "effect";
import { AppClock } from "../../application/ports.js";

export const LiveClockLayer = Layer.succeed(AppClock, {
  now: Effect.sync(() => new Date().toISOString()),
});

export const fixedClockLayer = (now: string) =>
  Layer.succeed(AppClock, {
    now: Effect.succeed(now),
  });
