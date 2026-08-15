import * as NodeAssert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  OllamaSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/unstable/http";
import { describe } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { makeOllamaTextGeneration } from "../../textGeneration/OllamaTextGeneration.ts";
import { makeOllamaAdapter } from "./OllamaAdapter.ts";

const settings = Schema.decodeSync(OllamaSettings)({});
const testLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-ollama-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer), Layer.provideMerge(FetchHttpClient.layer));

describe.runIf(process.env.T3_OLLAMA_INTEGRATION === "1")("Ollama adapter integration", () => {
  it.effect("streams a real reply from the local default model", () =>
    Effect.gen(function* () {
      const adapter = yield* makeOllamaAdapter(settings, {
        instanceId: ProviderInstanceId.make("ollama"),
      });
      const eventsFiber = yield* adapter.streamEvents.pipe(
        Stream.takeUntil((event) => event.type === "turn.completed"),
        Stream.runCollect,
        Effect.forkChild,
      );
      const threadId = ThreadId.make("ollama-integration");
      yield* adapter.startSession({
        threadId,
        provider: ProviderDriverKind.make("ollama"),
        providerInstanceId: ProviderInstanceId.make("ollama"),
        modelSelection: {
          instanceId: ProviderInstanceId.make("ollama"),
          model: "qwen3.6:35b-mlx",
        },
        runtimeMode: "full-access",
      });
      const turn = yield* adapter.sendTurn({
        threadId,
        input: "Reply with exactly: OLLAMA_T3_ADAPTER_OK",
      });
      const events = Array.from(yield* Fiber.join(eventsFiber));
      const reply = events
        .filter((event) => event.type === "content.delta")
        .filter((event) => event.payload.streamKind === "assistant_text")
        .map((event) => event.payload.delta)
        .join("");

      NodeAssert.match(reply, /OLLAMA_T3_ADAPTER_OK/);
      NodeAssert.equal(
        (turn.resumeCursor as { readonly schemaVersion?: unknown }).schemaVersion,
        1,
      );
      NodeAssert.equal(
        events.find((event) => event.type === "turn.completed")?.payload.totalCostUsd,
        0,
      );

      const textGeneration = yield* makeOllamaTextGeneration(settings);
      const title = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Add local Ollama support",
        modelSelection: {
          instanceId: ProviderInstanceId.make("ollama"),
          model: "qwen3.6:35b-mlx",
        },
      });
      NodeAssert.ok(title.title.length > 0);
    }).pipe(Effect.provide(testLayer), Effect.scoped),
  );
});
