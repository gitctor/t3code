# Kimi ACP Provider Report

Date: 2026-08-12

## Result

Kimi Code CLI is now a built-in `ProviderDriverKind` named `kimi`.

The driver starts `kimi acp` over stdio JSON-RPC. It supports session start, prompt streaming, interrupts, approvals, user input, resume, live model discovery, ACP login, and headless text generation.

The default provider instance ID is `kimi`. A crew member with `{ instanceId: "kimi" }` therefore resolves through the normal provider registry and dispatch path.

No orchestration phase 1–3 source file changed.

## Upstream PR Adaptation

Fetched upstream PR #5243 as `pr-5243-kimi`.

The PR contained three provider commits and a later merge from upstream main. I adapted the three provider commits. I did not apply the merge commit because this fork already has a newer and different base.

- `989ef3a5f` became `9bf696f9e`. This brought in the driver, adapter, ACP support, provider snapshot, model catalog, text generation, settings, web picker, icon, docs, and focused tests.
- `c8a863902` became `74cc65594`. This brought in grouped ACP model discovery and the corrected provider count.
- `7eb874d56` became `4fb52f8bd`. This brought in Kimi mock models, model-option forwarding, and the final text-generation fixes.
- `2add4dcfb` was written for this fork. It updates two upstream files for the Effect API version at this HEAD.
- `c760c0787` was written for this fork. It tests the default `kimi` instance-to-driver routing contract.

Each adapted upstream commit credits Maicon Fontana with `Co-authored-by`.

## Conflict Notes

The first and third upstream provider commits applied cleanly.

The second commit conflicted only in `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts`. I restored that file to `c8adb088d` and kept the non-orchestration changes.

I also excluded these upstream changes:

- `AGENTS.md`, because this task did not authorize instruction changes.
- All `ProviderRuntimeIngestion.ts` changes, because phase 1–3 orchestration was out of scope.

## Provider Behavior

- Binary probe: uses the configured binary path or `kimi` on `PATH`.
- Missing binary: returns an installed `false`, status `error` snapshot. Server startup does not crash.
- Session transport: starts `kimi acp` over stdio JSON-RPC.
- Authentication: uses the ACP `login` method.
- Catalog: publishes `kimi-code/k3`, `kimi-code/k3-256k`, `kimi-code/kimi-for-coding`, and `kimi-code/kimi-for-coding-highspeed` as fallbacks. ACP discovery can replace or extend them.
- Thinking options: publishes Low, High, and Max descriptors. High is the default.
- Model selection: sends full `kimi-code/*` model IDs and forwards live thinking or mode options.
- Turn hosting: supports ordinary provider threads, prompts, streaming responses, interrupts, approvals, user input, stop, and ACP resume.
- Text generation: supports commit messages, branch names, and thread titles through a restricted ACP client.

## Verification

All required focused tests passed:

| Test file | Result |
| --- | --- |
| `apps/server/src/provider/Layers/KimiAdapter.test.ts` | 3 passed |
| `apps/server/src/provider/Layers/KimiProvider.test.ts` | 5 passed |
| `apps/server/src/provider/acp/AcpRuntimeModel.test.ts` | 11 passed |
| `apps/server/src/provider/acp/KimiAcpSupport.test.ts` | 7 passed |
| `apps/server/src/textGeneration/KimiTextGeneration.test.ts` | 4 passed |
| `apps/server/src/provider/builtInDrivers.test.ts` | 1 passed |

The missing-binary test uses a deterministic nonexistent path and verifies the clean unavailable snapshot.

Package type checks passed:

- `apps/server`: `tsgo --noEmit`
- `apps/web`: `tsgo --noEmit`
- `packages/contracts`: `tsgo --noEmit`

The server check still prints existing Effect suggestions from orchestration and pull-request files. It exits successfully. I did not change those files.

No browser or live authenticated Kimi session was run. The ACP session path was tested with the repository mock agent.

## Real Kimi CLI Installation

The official install script is:

```bash
curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash
```

The official npm alternative is:

```bash
npm install -g @moonshot-ai/kimi-code
```

After installation, ensure `kimi` is on the T3 server process `PATH`. An explicit binary path can also be set in the Kimi provider settings.

Start `kimi` and run `/login`. The official CLI supports Kimi Code OAuth or a Moonshot AI Open Platform API key. See the [Kimi Code CLI docs](https://moonshotai.github.io/kimi-code/en/) and [official repository](https://github.com/MoonshotAI/kimi-code).

This machine already has `kimi` version `1.49.0`. I only ran its version and help commands. I did not change its authentication or configuration.

## Orchestration Gap

Kimi ACP `agent_thought_chunk` updates are translated into provider events with `streamKind: "reasoning_text"`.

The current phase 1–3 `ProviderRuntimeIngestion` implementation only projects `assistant_text` content deltas. It does not project `reasoning_text` into the visible worklog. The upstream PR included a capped reasoning buffer and worklog projection for this case, but those changes were intentionally excluded.

This gap affects visible Kimi thought-stream activity. It does not block driver registration, provider snapshots, default `kimi` instance routing, ordinary dispatch-created threads, assistant response streaming, or tool lifecycle events.

No other Kimi-specific orchestration gap was found.
