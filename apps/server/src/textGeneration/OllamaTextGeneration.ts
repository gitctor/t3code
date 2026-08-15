import {
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type OllamaSettings,
  ProviderDriverKind,
  TextGenerationError,
} from "@t3tools/contracts";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@t3tools/shared/git";
import { extractJsonObject } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient } from "effect/unstable/http";

import { completeOllamaChat } from "../provider/ollamaApi.ts";
import * as TextGeneration from "./TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
} from "./TextGenerationPrompts.ts";
import {
  sanitizeCommitSubject,
  sanitizePrTitle,
  sanitizeThreadTitle,
  toJsonSchemaObject,
} from "./TextGenerationUtils.ts";

const PROVIDER = ProviderDriverKind.make("ollama");
const DEFAULT_MODEL = DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[PROVIDER] ?? "qwen3.6:35b-mlx";
const isTextGenerationError = Schema.is(TextGenerationError);

export const makeOllamaTextGeneration = Effect.fn("makeOllamaTextGeneration")(function* (
  settings: OllamaSettings,
) {
  const httpClient = yield* HttpClient.HttpClient;

  const runOllamaJson = <S extends Schema.Top>(input: {
    readonly operation:
      | "generateCommitMessage"
      | "generatePrContent"
      | "generateBranchName"
      | "generateThreadTitle";
    readonly prompt: string;
    readonly outputSchemaJson: S;
    readonly model: string;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const response = yield* completeOllamaChat({
        settings,
        model: input.model || DEFAULT_MODEL,
        messages: [{ role: "user", content: input.prompt }],
        format: toJsonSchemaObject(input.outputSchemaJson),
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: `Ollama request to ${settings.baseUrl} failed.`,
              cause,
            }),
        ),
      );
      const output = response.message.content.trim();
      if (!output) {
        return yield* new TextGenerationError({
          operation: input.operation,
          detail: "Ollama returned empty structured output.",
        });
      }
      return yield* Schema.decodeEffect(Schema.fromJsonString(input.outputSchemaJson))(
        extractJsonObject(output),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation: input.operation,
              detail: "Ollama returned invalid structured output.",
              cause,
            }),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isTextGenerationError(cause)
          ? cause
          : new TextGenerationError({
              operation: input.operation,
              detail: "Ollama text generation failed.",
              cause,
            }),
      ),
    );

  const generateCommitMessage: TextGeneration.TextGeneration["Service"]["generateCommitMessage"] =
    Effect.fn("OllamaTextGeneration.generateCommitMessage")(function* (input) {
      const { prompt, outputSchema } = buildCommitMessagePrompt({
        branch: input.branch,
        stagedSummary: input.stagedSummary,
        stagedPatch: input.stagedPatch,
        includeBranch: input.includeBranch === true,
        policy: input.policy,
      });
      const generated = yield* runOllamaJson({
        operation: "generateCommitMessage",
        prompt,
        outputSchemaJson: outputSchema,
        model: input.modelSelection.model,
      });
      return {
        subject: sanitizeCommitSubject(generated.subject),
        body: generated.body.trim(),
        ...("branch" in generated && typeof generated.branch === "string"
          ? { branch: sanitizeFeatureBranchName(generated.branch) }
          : {}),
      };
    });

  const generatePrContent: TextGeneration.TextGeneration["Service"]["generatePrContent"] =
    Effect.fn("OllamaTextGeneration.generatePrContent")(function* (input) {
      const { prompt, outputSchema } = buildPrContentPrompt({
        baseBranch: input.baseBranch,
        headBranch: input.headBranch,
        commitSummary: input.commitSummary,
        diffSummary: input.diffSummary,
        diffPatch: input.diffPatch,
        policy: input.policy,
        changeRequestTemplate: input.changeRequestTemplate,
      });
      const generated = yield* runOllamaJson({
        operation: "generatePrContent",
        prompt,
        outputSchemaJson: outputSchema,
        model: input.modelSelection.model,
      });
      return { title: sanitizePrTitle(generated.title), body: generated.body.trim() };
    });

  const generateBranchName: TextGeneration.TextGeneration["Service"]["generateBranchName"] =
    Effect.fn("OllamaTextGeneration.generateBranchName")(function* (input) {
      const { prompt, outputSchema } = buildBranchNamePrompt({
        message: input.message,
        attachments: input.attachments,
      });
      const generated = yield* runOllamaJson({
        operation: "generateBranchName",
        prompt,
        outputSchemaJson: outputSchema,
        model: input.modelSelection.model,
      });
      return { branch: sanitizeBranchFragment(generated.branch) };
    });

  const generateThreadTitle: TextGeneration.TextGeneration["Service"]["generateThreadTitle"] =
    Effect.fn("OllamaTextGeneration.generateThreadTitle")(function* (input) {
      const { prompt, outputSchema } = buildThreadTitlePrompt({
        message: input.message,
        previousTitle: input.previousTitle,
        attachments: input.attachments,
      });
      const generated = yield* runOllamaJson({
        operation: "generateThreadTitle",
        prompt,
        outputSchemaJson: outputSchema,
        model: input.modelSelection.model,
      });
      return { title: sanitizeThreadTitle(generated.title) };
    });

  return {
    generateCommitMessage,
    generatePrContent,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGeneration.TextGeneration["Service"];
});
