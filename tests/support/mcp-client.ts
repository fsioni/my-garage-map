import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Layer, ManagedRuntime } from "effect";
import { z } from "zod";
import { fixedClockLayer } from "../../src/infrastructure/clock/live-clock.js";
import { sqliteRepositoryLayer } from "../../src/infrastructure/database/sqlite.js";
import { documentStorageLayer } from "../../src/infrastructure/filesystem/document-storage.js";
import { createGarageServer, type EffectRunner } from "../../src/mcp/server.js";

export interface McpTestContext {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

export const setupMcpClient = async (
  options: { readonly runner?: EffectRunner; readonly documentRoot?: string } = {},
): Promise<McpTestContext> => {
  const runtime =
    options.runner === undefined
      ? ManagedRuntime.make(
          Layer.mergeAll(
            sqliteRepositoryLayer(":memory:"),
            fixedClockLayer("2026-06-01T10:00:00.000Z"),
            documentStorageLayer(options.documentRoot ?? "/garage/docs"),
          ),
        )
      : undefined;
  const runner =
    options.runner ??
    ({
      runPromise: (effect) => runtime?.runPromise(effect) as Promise<never>,
    } satisfies EffectRunner);
  const server = createGarageServer(runner);
  const client = new Client({ name: "garage-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
      await runtime?.dispose();
    },
  };
};

const successSchema = z.object({ result: z.unknown() });
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export const callTool = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError === true) {
    throw new Error(`Expected ${name} to succeed: ${JSON.stringify(response.structuredContent)}`);
  }
  return successSchema.parse(response.structuredContent).result;
};

export const callToolError = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{
  readonly response: unknown;
  readonly code?: string;
  readonly message?: string;
}> => {
  const response = await client.callTool({ name, arguments: args });
  if (response.isError !== true) {
    throw new Error(`Expected ${name} to fail: ${JSON.stringify(response.structuredContent)}`);
  }
  const parsed = errorSchema.safeParse(response.structuredContent);
  return {
    response,
    ...(parsed.success ? parsed.data.error : {}),
  };
};

export const createTestVehicle = async (client: Client): Promise<string> => {
  const result = z.object({ id: z.string() }).parse(
    await callTool(client, "create_vehicle", {
      name: "Daily",
      make: "Peugeot",
      model: "2008",
      initialMileageKm: 100_000,
    }),
  );
  return result.id;
};
