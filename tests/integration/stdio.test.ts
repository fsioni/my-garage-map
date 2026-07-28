import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

const waitFor = (
  predicate: () => boolean,
  subscribe: (check: () => void) => void,
  timeoutMs = 5_000,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for child process")),
      timeoutMs,
    );
    const check = () => {
      if (!predicate()) return;
      clearTimeout(timeout);
      resolve();
    };
    subscribe(check);
    check();
  });

describe("stdio process lifecycle", () => {
  it("starts silently on stdout, logs structured metadata, and shuts down on SIGTERM", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GARAGE_DB_PATH: ":memory:",
        GARAGE_LOG_LEVEL: "info",
        GARAGE_DOCUMENT_ROOT: "/garage/docs",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    try {
      await waitFor(
        () => stderr.includes('"event":"server_started"'),
        (check) => child.stderr.on("data", check),
      );
      expect(stdout).toBe("");
      const startup = stderr
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find(({ event }) => event === "server_started");
      expect(startup).toEqual({
        level: "info",
        event: "server_started",
        transport: "stdio",
        database: ":memory:",
      });

      child.kill("SIGTERM");
      await waitFor(
        () => child.exitCode !== null,
        (check) => child.once("exit", check),
      );
      expect(child.exitCode).toBe(0);
      expect(stderr).toContain('"event":"shutdown"');
      expect(stderr).toContain('"signal":"SIGTERM"');
      expect(stdout).toBe("");
    } finally {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  });

  it("fails closed with a structured startup error for invalid configuration", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GARAGE_DB_PATH: ":memory:",
        GARAGE_LOG_LEVEL: "verbose",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    await waitFor(
      () => child.exitCode !== null,
      (check) => child.once("exit", check),
    );
    expect(child.exitCode).toBe(1);
    expect(stdout).toBe("");
    const failure = JSON.parse(stderr.trim()) as Record<string, unknown>;
    expect(failure).toEqual({
      level: "error",
      event: "startup_failed",
      message: "GARAGE_LOG_LEVEL must be debug, info, warn, or error",
    });
  });
});
