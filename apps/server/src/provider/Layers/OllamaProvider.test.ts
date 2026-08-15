import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import { OllamaSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { checkOllamaProviderStatus } from "./OllamaProvider.ts";

const decodeSettings = Schema.decodeSync(OllamaSettings);
const settings = decodeSettings({});

const layerWithResponse = (body: unknown, status = 200) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(body, { status }))),
    ),
  );

it.layer(
  layerWithResponse({
    models: [
      { name: "qwen3.6:27b-mlx", capabilities: ["completion", "tools"] },
      { name: "qwen3.6:35b-mlx", capabilities: ["completion", "tools"] },
      { name: "newly-pulled:model", capabilities: ["completion"] },
    ],
  }),
)("checkOllamaProviderStatus", (it) => {
  it.effect("publishes every live model and marks the chosen local default", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOllamaProviderStatus(settings);

      NodeAssert.equal(snapshot.status, "ready");
      NodeAssert.equal(snapshot.auth.label, "Local — free");
      NodeAssert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["qwen3.6:27b-mlx", "qwen3.6:35b-mlx", "newly-pulled:model"],
      );
      NodeAssert.equal(snapshot.models.find((model) => model.isDefault)?.slug, "qwen3.6:35b-mlx");
    }),
  );
});

it.layer(layerWithResponse({ error: "offline" }, 503))("unavailable Ollama server", (it) => {
  it.effect("returns a clear unavailable snapshot without failing startup", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkOllamaProviderStatus(settings);

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.installed, false);
      NodeAssert.match(snapshot.message ?? "", /Start Ollama and retry/);
    }),
  );
});
