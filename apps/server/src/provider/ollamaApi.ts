import type { OllamaSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/unstable/encoding/Ndjson";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

export const OllamaTagsResponse = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      model: Schema.optional(Schema.String),
      capabilities: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
export type OllamaTagsResponse = typeof OllamaTagsResponse.Type;

export const OllamaChatChunk = Schema.Struct({
  model: Schema.String,
  message: Schema.Struct({
    role: Schema.String,
    content: Schema.String,
    thinking: Schema.optional(Schema.String),
  }),
  done: Schema.Boolean,
  done_reason: Schema.optional(Schema.String),
  prompt_eval_count: Schema.optional(Schema.Int),
  eval_count: Schema.optional(Schema.Int),
  total_duration: Schema.optional(Schema.Int),
});
export type OllamaChatChunk = typeof OllamaChatChunk.Type;

export const OllamaChatResponse = Schema.Struct({
  model: Schema.String,
  message: Schema.Struct({
    role: Schema.String,
    content: Schema.String,
    thinking: Schema.optional(Schema.String),
  }),
  done: Schema.Boolean,
  done_reason: Schema.optional(Schema.String),
  prompt_eval_count: Schema.optional(Schema.Int),
  eval_count: Schema.optional(Schema.Int),
  total_duration: Schema.optional(Schema.Int),
});
export type OllamaChatResponse = typeof OllamaChatResponse.Type;

export interface OllamaChatMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
  readonly images?: ReadonlyArray<string> | undefined;
}

export function ollamaApiUrl(settings: OllamaSettings, path: string): string {
  return `${settings.baseUrl.replace(/\/+$/, "")}${path}`;
}

export const listOllamaModels = Effect.fn("listOllamaModels")(function* (settings: OllamaSettings) {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* httpClient
    .execute(HttpClientRequest.get(ollamaApiUrl(settings, "/api/tags")))
    .pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.flatMap(HttpClientResponse.schemaBodyJson(OllamaTagsResponse)),
    );
});

export const streamOllamaChat = Effect.fn("streamOllamaChat")(function* (input: {
  readonly settings: OllamaSettings;
  readonly model: string;
  readonly messages: ReadonlyArray<OllamaChatMessage>;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const response = yield* HttpClientRequest.post(ollamaApiUrl(input.settings, "/api/chat")).pipe(
    HttpClientRequest.bodyJson({
      model: input.model,
      messages: input.messages,
      stream: true,
      think: true,
    }),
    Effect.flatMap(httpClient.execute),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
  );
  return response.stream.pipe(
    Stream.pipeThroughChannel(Ndjson.decodeSchema(OllamaChatChunk)({ ignoreEmptyLines: true })),
  );
});

export const completeOllamaChat = Effect.fn("completeOllamaChat")(function* (input: {
  readonly settings: OllamaSettings;
  readonly model: string;
  readonly messages: ReadonlyArray<OllamaChatMessage>;
  readonly format?: unknown;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  return yield* HttpClientRequest.post(ollamaApiUrl(input.settings, "/api/chat")).pipe(
    HttpClientRequest.bodyJson({
      model: input.model,
      messages: input.messages,
      stream: false,
      think: false,
      ...(input.format === undefined ? {} : { format: input.format }),
    }),
    Effect.flatMap(httpClient.execute),
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(OllamaChatResponse)),
  );
});
