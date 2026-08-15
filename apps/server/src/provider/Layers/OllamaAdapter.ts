import {
  type ChatAttachment,
  EventId,
  type OllamaSettings,
  ProviderDriverKind,
  type ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  RuntimeItemId,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient } from "effect/unstable/http";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import type { ProviderAdapterShape, ProviderThreadSnapshot } from "../Services/ProviderAdapter.ts";
import { type OllamaChatMessage, type OllamaChatChunk, streamOllamaChat } from "../ollamaApi.ts";

const PROVIDER = ProviderDriverKind.make("ollama");
const OLLAMA_RESUME_VERSION = 1 as const;
const OllamaResumeCursor = Schema.Struct({
  schemaVersion: Schema.Literal(OLLAMA_RESUME_VERSION),
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["system", "user", "assistant"]),
      content: Schema.String,
    }),
  ),
});

interface OllamaTurnSnapshot {
  readonly id: TurnId;
  readonly user: OllamaChatMessage;
  readonly assistant: OllamaChatMessage;
}

interface OllamaSessionContext {
  session: ProviderSession;
  messages: Array<OllamaChatMessage>;
  turns: Array<OllamaTurnSnapshot>;
  activeCancellation: Deferred.Deferred<boolean> | undefined;
  stopped: boolean;
}

type OllamaAdapterError =
  | ProviderAdapterRequestError
  | ProviderAdapterSessionNotFoundError
  | ProviderAdapterValidationError;

export interface OllamaAdapterOptions {
  readonly instanceId?: ProviderInstanceId | undefined;
}

export const makeOllamaAdapter = Effect.fn("makeOllamaAdapter")(function* (
  settings: OllamaSettings,
  options: OllamaAdapterOptions = {},
) {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const httpClient = yield* HttpClient.HttpClient;
  const serverConfig = yield* ServerConfig;
  const sessions = new Map<ThreadId, OllamaSessionContext>();
  const runtimeEvents = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const boundInstanceId = options.instanceId;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = crypto.randomUUIDv4.pipe(
    Effect.mapError(
      (cause) =>
        new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "crypto/randomUUIDv4",
          detail: "Failed to create an Ollama runtime identifier.",
          cause,
        }),
    ),
  );
  const makeEventStamp = () =>
    Effect.all({
      eventId: randomId.pipe(Effect.map(EventId.make)),
      createdAt: nowIso,
    });
  const publish = (event: ProviderRuntimeEvent) =>
    PubSub.publish(runtimeEvents, event).pipe(Effect.asVoid);
  const eventIdentity = boundInstanceId ? { providerInstanceId: boundInstanceId } : {};

  const requireSession = (
    threadId: ThreadId,
  ): Effect.Effect<OllamaSessionContext, ProviderAdapterSessionNotFoundError> => {
    const context = sessions.get(threadId);
    if (!context || context.stopped) {
      return Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }));
    }
    return Effect.succeed(context);
  };

  const readAttachmentImages = (input: { readonly attachments: ReadonlyArray<ChatAttachment> }) =>
    Effect.forEach(input.attachments, (attachment) =>
      Effect.gen(function* () {
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "api/chat",
            detail: `Invalid attachment id '${attachment.id}'.`,
          });
        }
        return yield* fileSystem.readFile(attachmentPath).pipe(
          Effect.map(Encoding.encodeBase64),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "api/chat",
                detail: `Failed to read attachment '${attachment.name}'.`,
                cause,
              }),
          ),
        );
      }),
    );

  const startSession: ProviderAdapterShape<OllamaAdapterError>["startSession"] = (input) =>
    Effect.gen(function* () {
      if (input.provider !== undefined && input.provider !== PROVIDER) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
        });
      }
      if (
        boundInstanceId !== undefined &&
        input.providerInstanceId !== undefined &&
        input.providerInstanceId !== boundInstanceId
      ) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "startSession",
          issue: `Expected provider instance '${boundInstanceId}' but received '${input.providerInstanceId}'.`,
        });
      }

      const createdAt = yield* nowIso;
      const model = input.modelSelection?.model;
      const resumed = Schema.decodeUnknownOption(OllamaResumeCursor)(input.resumeCursor);
      const messages: Array<OllamaChatMessage> = Option.match(resumed, {
        onNone: () => [],
        onSome: (cursor) => [...cursor.messages],
      });
      if (input.additionalInstructions?.trim() && messages.length === 0) {
        messages.push({ role: "system", content: input.additionalInstructions.trim() });
      }
      const session: ProviderSession = {
        provider: PROVIDER,
        ...(boundInstanceId ? { providerInstanceId: boundInstanceId } : {}),
        status: "ready",
        runtimeMode: input.runtimeMode,
        ...(input.cwd ? { cwd: input.cwd } : {}),
        ...(model ? { model } : {}),
        threadId: input.threadId,
        ...(Option.isSome(resumed) ? { resumeCursor: resumed.value } : {}),
        createdAt,
        updatedAt: createdAt,
      };
      sessions.set(input.threadId, {
        session,
        messages,
        turns: [],
        activeCancellation: undefined,
        stopped: false,
      });

      yield* publish({
        type: "session.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId: input.threadId,
        payload: { message: "Ollama session ready" },
      });
      yield* publish({
        type: "session.state.changed",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId: input.threadId,
        payload: { state: "ready", reason: "Connected to local Ollama" },
      });
      yield* publish({
        type: "thread.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId: input.threadId,
        payload: { providerThreadId: input.threadId },
      });
      return session;
    });

  const sendTurn: ProviderAdapterShape<OllamaAdapterError>["sendTurn"] = (input) =>
    Effect.gen(function* () {
      const context = yield* requireSession(input.threadId);
      if (context.activeCancellation !== undefined) {
        return yield* new ProviderAdapterRequestError({
          provider: PROVIDER,
          method: "api/chat",
          detail: "Ollama is already processing a turn for this thread.",
        });
      }

      const text = input.input?.trim() ?? "";
      const attachments = input.attachments ?? [];
      if (!text && attachments.length === 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "Turn requires non-empty text or attachments.",
        });
      }

      const model = input.modelSelection?.model ?? context.session.model;
      if (!model) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "sendTurn",
          issue: "An Ollama model must be selected.",
        });
      }

      const images = yield* readAttachmentImages({ attachments });
      const userMessage: OllamaChatMessage = {
        role: "user",
        content: text,
        ...(images.length > 0 ? { images } : {}),
      };
      const turnId = TurnId.make(yield* randomId);
      const assistantItemId = RuntimeItemId.make(yield* randomId);
      const reasoningItemId = RuntimeItemId.make(yield* randomId);
      const cancellation = yield* Deferred.make<boolean>();
      context.activeCancellation = cancellation;
      context.session = {
        ...context.session,
        status: "running",
        activeTurnId: turnId,
        model,
        updatedAt: yield* nowIso,
      };

      yield* publish({
        type: "turn.started",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId: input.threadId,
        turnId,
        payload: { model },
      });

      let assistantText = "";
      let assistantStarted = false;
      let reasoningStarted = false;
      let finalChunk: OllamaChatChunk | undefined;
      const runStream = Effect.gen(function* () {
        const stream = yield* streamOllamaChat({
          settings,
          model,
          messages: [...context.messages, userMessage],
        }).pipe(Effect.provideService(HttpClient.HttpClient, httpClient));
        yield* stream.pipe(
          Stream.runForEach((chunk) =>
            Effect.gen(function* () {
              finalChunk = chunk;
              const reasoning = chunk.message.thinking ?? "";
              if (reasoning.length > 0) {
                if (!reasoningStarted) {
                  reasoningStarted = true;
                  yield* publish({
                    type: "item.started",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    ...eventIdentity,
                    threadId: input.threadId,
                    turnId,
                    itemId: reasoningItemId,
                    payload: { itemType: "reasoning", status: "inProgress" },
                  });
                }
                yield* publish({
                  type: "content.delta",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  ...eventIdentity,
                  threadId: input.threadId,
                  turnId,
                  itemId: reasoningItemId,
                  payload: { streamKind: "reasoning_text", delta: reasoning },
                });
              }
              if (chunk.message.content.length > 0) {
                if (!assistantStarted) {
                  assistantStarted = true;
                  yield* publish({
                    type: "item.started",
                    ...(yield* makeEventStamp()),
                    provider: PROVIDER,
                    ...eventIdentity,
                    threadId: input.threadId,
                    turnId,
                    itemId: assistantItemId,
                    payload: { itemType: "assistant_message", status: "inProgress" },
                  });
                }
                assistantText += chunk.message.content;
                yield* publish({
                  type: "content.delta",
                  ...(yield* makeEventStamp()),
                  provider: PROVIDER,
                  ...eventIdentity,
                  threadId: input.threadId,
                  turnId,
                  itemId: assistantItemId,
                  payload: { streamKind: "assistant_text", delta: chunk.message.content },
                });
              }
            }),
          ),
        );
        return true;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "api/chat",
              detail: `Ollama request to ${settings.baseUrl} failed.`,
              cause,
            }),
        ),
      );

      const completed = yield* Effect.raceFirst(runStream, Deferred.await(cancellation)).pipe(
        Effect.tapError((error) =>
          Effect.gen(function* () {
            const { activeTurnId: _failedTurnId, ...sessionWithoutTurn } = context.session;
            context.session = {
              ...sessionWithoutTurn,
              status: "error",
              updatedAt: yield* nowIso,
              lastError: error.message,
            };
            yield* publish({
              type: "turn.completed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              ...eventIdentity,
              threadId: input.threadId,
              turnId,
              payload: { state: "failed", errorMessage: error.message },
            });
          }),
        ),
        Effect.ensuring(Effect.sync(() => void (context.activeCancellation = undefined))),
      );

      if (reasoningStarted) {
        yield* publish({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          ...eventIdentity,
          threadId: input.threadId,
          turnId,
          itemId: reasoningItemId,
          payload: { itemType: "reasoning", status: "completed" },
        });
      }
      if (assistantStarted) {
        yield* publish({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          ...eventIdentity,
          threadId: input.threadId,
          turnId,
          itemId: assistantItemId,
          payload: { itemType: "assistant_message", status: "completed" },
        });
      }

      const updatedAt = yield* nowIso;
      const { activeTurnId: _activeTurnId, ...sessionWithoutTurn } = context.session;
      context.session = { ...sessionWithoutTurn, status: "ready", updatedAt };
      if (completed) {
        const assistantMessage: OllamaChatMessage = {
          role: "assistant",
          content: assistantText,
        };
        context.messages.push(userMessage, assistantMessage);
        context.turns.push({ id: turnId, user: userMessage, assistant: assistantMessage });
      }

      const resumeCursor = {
        schemaVersion: OLLAMA_RESUME_VERSION,
        messages: context.messages.map(({ role, content }) => ({ role, content })),
      };
      context.session = { ...context.session, resumeCursor };

      const usage = finalChunk
        ? {
            usedTokens: (finalChunk.prompt_eval_count ?? 0) + (finalChunk.eval_count ?? 0),
            totalProcessedTokens:
              (finalChunk.prompt_eval_count ?? 0) + (finalChunk.eval_count ?? 0),
            inputTokens: finalChunk.prompt_eval_count ?? 0,
            outputTokens: finalChunk.eval_count ?? 0,
            durationMs: Math.round((finalChunk.total_duration ?? 0) / 1_000_000),
          }
        : undefined;
      if (usage) {
        yield* publish({
          type: "thread.token-usage.updated",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          ...eventIdentity,
          threadId: input.threadId,
          turnId,
          payload: { usage },
        });
      }
      yield* publish({
        type: "turn.completed",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId: input.threadId,
        turnId,
        payload: {
          state: completed ? "completed" : "cancelled",
          stopReason: completed ? (finalChunk?.done_reason ?? "stop") : "cancelled",
          ...(usage ? { usage } : {}),
          totalCostUsd: 0,
        },
      });

      return { threadId: input.threadId, turnId, resumeCursor };
    });

  const interruptTurn: ProviderAdapterShape<OllamaAdapterError>["interruptTurn"] = (
    threadId,
    turnId,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      const activeTurnId = context.session.activeTurnId;
      if (turnId !== undefined && activeTurnId !== undefined && turnId !== activeTurnId) return;
      if (context.activeCancellation !== undefined) {
        yield* Deferred.succeed(context.activeCancellation, false).pipe(Effect.asVoid);
      }
    });

  const stopSession: ProviderAdapterShape<OllamaAdapterError>["stopSession"] = (threadId) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (context.activeCancellation !== undefined) {
        yield* Deferred.succeed(context.activeCancellation, false).pipe(Effect.asVoid);
      }
      context.stopped = true;
      context.session = { ...context.session, status: "closed", updatedAt: yield* nowIso };
      sessions.delete(threadId);
      yield* publish({
        type: "session.exited",
        ...(yield* makeEventStamp()),
        provider: PROVIDER,
        ...eventIdentity,
        threadId,
        payload: { exitKind: "graceful" },
      });
    });

  const readThread = (threadId: ThreadId) =>
    requireSession(threadId).pipe(
      Effect.map(
        (context): ProviderThreadSnapshot => ({
          threadId,
          turns: context.turns.map((turn) => ({
            id: turn.id,
            items: [turn.user, turn.assistant],
          })),
        }),
      ),
    );

  const rollbackThread: ProviderAdapterShape<OllamaAdapterError>["rollbackThread"] = (
    threadId,
    numTurns,
  ) =>
    Effect.gen(function* () {
      const context = yield* requireSession(threadId);
      if (!Number.isInteger(numTurns) || numTurns < 0) {
        return yield* new ProviderAdapterValidationError({
          provider: PROVIDER,
          operation: "rollbackThread",
          issue: "numTurns must be a non-negative integer.",
        });
      }
      context.turns = context.turns.slice(0, Math.max(0, context.turns.length - numTurns));
      const systemMessages = context.messages.filter((message) => message.role === "system");
      context.messages = [
        ...systemMessages,
        ...context.turns.flatMap((turn) => [turn.user, turn.assistant]),
      ];
      return yield* readThread(threadId);
    });

  const unsupportedResponse = (operation: string) =>
    Effect.fail(
      new ProviderAdapterValidationError({
        provider: PROVIDER,
        operation,
        issue: "Ollama does not issue interactive approval or user-input requests.",
      }),
    );

  return {
    provider: PROVIDER,
    capabilities: { sessionModelSwitch: "unsupported" },
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest: () => unsupportedResponse("respondToRequest"),
    respondToUserInput: () => unsupportedResponse("respondToUserInput"),
    stopSession,
    listSessions: () => Effect.succeed([...sessions.values()].map((context) => context.session)),
    hasSession: (threadId) => Effect.succeed(sessions.has(threadId)),
    readThread,
    rollbackThread,
    stopAll: () =>
      Effect.forEach([...sessions.keys()], stopSession, { concurrency: "unbounded" }).pipe(
        Effect.asVoid,
      ),
    streamEvents: Stream.fromPubSub(runtimeEvents),
  } satisfies ProviderAdapterShape<OllamaAdapterError>;
});
