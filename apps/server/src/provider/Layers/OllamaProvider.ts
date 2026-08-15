import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelCapabilities,
  type OllamaSettings,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { HttpClient } from "effect/unstable/http";

import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";
import { listOllamaModels } from "../ollamaApi.ts";

const PROVIDER = ProviderDriverKind.make("ollama");
const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER[PROVIDER] ?? "qwen3.6:35b-mlx";
const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({ optionDescriptors: [] });
const OLLAMA_PRESENTATION = {
  displayName: "Ollama",
  badgeLabel: "Local — free",
  showInteractionModeToggle: false,
  requiresNewThreadForModelChange: true,
} as const;

export const buildInitialOllamaProviderSnapshot = Effect.fn("buildInitialOllamaProviderSnapshot")(
  function* (settings: OllamaSettings): Effect.fn.Return<ServerProviderDraft> {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    return buildServerProvider({
      presentation: OLLAMA_PRESENTATION,
      enabled: settings.enabled,
      checkedAt,
      models: [],
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: `Checking the Ollama server at ${settings.baseUrl}...`,
          }
        : {
            installed: false,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Ollama is disabled in T3 Code settings.",
          },
    });
  },
);

export const checkOllamaProviderStatus = Effect.fn("checkOllamaProviderStatus")(function* (
  settings: OllamaSettings,
): Effect.fn.Return<ServerProviderDraft, never, HttpClient.HttpClient> {
  const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
  if (!settings.enabled) {
    return yield* buildInitialOllamaProviderSnapshot(settings);
  }

  const result = yield* listOllamaModels(settings).pipe(Effect.result);
  if (Result.isFailure(result)) {
    yield* Effect.logWarning("Ollama model discovery failed.", { cause: result.failure });
    return buildServerProvider({
      presentation: OLLAMA_PRESENTATION,
      enabled: true,
      checkedAt,
      models: [],
      probe: {
        installed: false,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: `Couldn't reach the Ollama server at ${settings.baseUrl}. Start Ollama and retry.`,
      },
    });
  }

  const seen = new Set<string>();
  const models = result.success.models.flatMap((entry): ReadonlyArray<ServerProviderModel> => {
    const slug = (entry.name || entry.model || "").trim();
    if (!slug || seen.has(slug)) return [];
    seen.add(slug);
    return [
      {
        slug,
        name: slug,
        isCustom: false,
        ...(slug === DEFAULT_MODEL ? { isDefault: true } : {}),
        capabilities: EMPTY_CAPABILITIES,
      },
    ];
  });

  return buildServerProvider({
    presentation: OLLAMA_PRESENTATION,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: models.length > 0 ? "ready" : "warning",
      auth: { status: "authenticated", type: "Local", label: "Local — free" },
      ...(models.length === 0 ? { message: "Ollama is running but has no local models." } : {}),
    },
  });
});
