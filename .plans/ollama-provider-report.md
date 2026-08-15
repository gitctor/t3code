# Ollama Provider Report

## Result

Path taken: **new native `ollama` driver**.

The required OpenCode-first check worked at the CLI layer but failed the full T3 Code acceptance
path. OpenCode 1.18.18 could advertise and stream both local models, but T3 Code would still expose
them under the OpenCode provider, retain OpenCode's default model, and omit the required
`Local — free` limits state. That did not meet the requested Ollama settings and provider surface.

The native driver connects to the configured Ollama URL. It does not start, stop, or manage the
Ollama process.

## OpenCode-first evidence

- Installed OpenCode 1.18.18 with Homebrew.
- Added the Ollama provider and both installed models to
  `~/.config/opencode/opencode.json`, with `qwen3.6:35b-mlx` as the default.
- `opencode models --verbose` advertised:
  - `ollama/qwen3.6:35b-mlx`
  - `ollama/qwen3.6:27b-mlx`
- A direct OpenCode run against `ollama/qwen3.6:35b-mlx` streamed
  `OLLAMA_T3_STREAM_OK` and reported cost `0`.

That setup remains available, but the committed implementation does not depend on OpenCode.

## Implemented behavior

- Adds `OllamaSettings` with default Base URL `http://127.0.0.1:11434`.
- Discovers every installed model from `GET /api/tags`; no model catalog is hardcoded.
- Marks `qwen3.6:35b-mlx` as the default when Ollama advertises it.
- Shows a clear unavailable snapshot when the server cannot be reached and does not block startup.
- Streams `/api/chat` NDJSON into canonical T3 reasoning and assistant events.
- Supports image attachments, interruption, rollback, and resumable text conversation context.
- Routes text-generation work such as thread titles through the selected local model.
- Emits token usage with `totalCostUsd: 0`.
- Shows `Local — free` in the limits surface and renders no Ollama quota meter.
- Adds Ollama to provider settings, model selection, provider icons, and the starter crew.
- Keeps Ollama model entry live-discovery-only in settings; manually entered model slugs are not
  offered.
- Crew test-flight cheapest-model resolution uses the model marked default, so Ollama resolves to
  `qwen3.6:35b-mlx`.
- `OrchestrationMcpPolicy` needed no change. Crew dispatch policy is provider-agnostic, and the
  direct Ollama adapter does not emit interactive approval requests or grant planner MCP tools.

## Files touched

Contracts and shared model behavior:

- `packages/contracts/src/settings.ts`
- `packages/contracts/src/settings.test.ts`
- `packages/contracts/src/model.ts`
- `packages/shared/src/model.test.ts`

Server driver, transport, text generation, and tests:

- `apps/server/src/provider/ollamaApi.ts`
- `apps/server/src/provider/Drivers/OllamaDriver.ts`
- `apps/server/src/provider/Layers/OllamaAdapter.ts`
- `apps/server/src/provider/Layers/OllamaAdapter.integration.test.ts`
- `apps/server/src/provider/Layers/OllamaProvider.ts`
- `apps/server/src/provider/Layers/OllamaProvider.test.ts`
- `apps/server/src/provider/builtInDrivers.ts`
- `apps/server/src/provider/builtInDrivers.test.ts`
- `apps/server/src/textGeneration/OllamaTextGeneration.ts`
- `apps/server/src/textGeneration/TextGeneration.ts`

Web provider, model, crew, and limits surfaces:

- `apps/web/src/components/Icons.tsx`
- `apps/web/src/components/chat/providerIconUtils.ts`
- `apps/web/src/components/settings/ProviderInstanceCard.tsx`
- `apps/web/src/components/settings/ProviderModelsSection.tsx`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/settings/providerDriverMeta.ts`
- `apps/web/src/components/usage/AccountLimits.tsx`
- `apps/web/src/components/usage/usageProviders.ts`
- `apps/web/src/components/usage/usageProviders.test.ts`
- `apps/web/src/crewSelection.ts`
- `apps/web/src/modelSelection.ts`
- `apps/web/src/session-logic.ts`

Documentation:

- `README.md`
- `docs/user/install.md`
- `docs/internals/providers.md`
- `docs/internals/overview.md`
- `docs/internals/glossary.md`
- `.plans/ollama-provider-report.md`

## Streaming proof

The focused native integration test connected to the existing listener at
`127.0.0.1:11434` (PID 2095), selected `qwen3.6:35b-mlx`, sent the exact prompt
`Reply with exactly: OLLAMA_T3_ADAPTER_OK`, collected canonical `content.delta` events, and
asserted the streamed reply contained `OLLAMA_T3_ADAPTER_OK`. It also asserted the completed turn
cost was `0`, verified a versioned resume cursor, and completed a structured thread-title request
through `OllamaTextGeneration`.

Command:

```bash
T3_OLLAMA_INTEGRATION=1 pnpm exec vp test run \
  apps/server/src/provider/Layers/OllamaAdapter.integration.test.ts
```

Result: 1 test passed.

## Verification

- Touched-package typechecks passed:
  - `packages/contracts`
  - `packages/shared`
  - `apps/server`
  - `apps/web`
- Production builds passed:
  - `pnpm --filter @t3tools/web build`
  - `pnpm --filter t3 build:bundle`
- Required and focused suite block: 8 files passed, 265 tests passed.
- Additional web model/settings regression block: 4 files passed, 27 tests passed.
- Live Ollama adapter and structured text-generation integration: 1 test passed.
- `git diff --check` passed before commits.

The build printed the repository's existing Node engine warning because this shell uses Node
25.9.0 while the workspace requests Node 24.13.1. Both builds completed successfully.

## Operator selection and restart

**A restart is required** because the running T3 app loaded its provider registry before this new
driver existed. No process was restarted, killed, or relaunched during this work.

After the operator restarts T3 Code:

1. Open **Settings** → **Providers** → **Ollama**.
2. Keep Base URL as `http://127.0.0.1:11434`, or set the URL of another reachable Ollama server.
3. Start a new thread and open the provider/model picker.
4. Select **Ollama** → **qwen3.6:35b-mlx**. The `qwen3.6:27b-mlx` fallback is also listed.

Newly pulled models appear after the provider catalog refresh; no code or settings edit is needed.

## Local commits

- `594a5f69c feat(server): add local Ollama provider`
- `731a11d19 feat(web): expose local Ollama models`

No push or pull request was made.
