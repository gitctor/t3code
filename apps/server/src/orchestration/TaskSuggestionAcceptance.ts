import {
  isProviderAvailable,
  type ModelSelection,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
  type ServerProvider,
  type ServerProviderModel,
  type TaskSuggestion,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

function isUsableProvider(provider: ServerProvider): boolean {
  return provider.enabled && provider.installed && isProviderAvailable(provider);
}

function matchingSelection(
  provider: ServerProvider,
  selections: ReadonlyArray<ModelSelection | null | undefined>,
): ModelSelection | null {
  return selections.find((selection) => selection?.instanceId === provider.instanceId) ?? null;
}

function resolveRecommendedModel(
  provider: ServerProvider,
  recommendation: string | undefined,
): ServerProviderModel | null {
  if (recommendation === undefined) return null;
  return provider.models.find((model) => model.slug === recommendation) ?? null;
}

function resolveDefaultModel(
  provider: ServerProvider,
  fallbackSelection: ModelSelection | null,
): { readonly model: string; readonly capabilities: ServerProviderModel["capabilities"] } | null {
  const providerDefault =
    provider.models.find((model) => model.isDefault === true) ?? provider.models[0] ?? null;
  if (providerDefault !== null) {
    return { model: providerDefault.slug, capabilities: providerDefault.capabilities };
  }
  if (fallbackSelection !== null) {
    return { model: fallbackSelection.model, capabilities: null };
  }
  return null;
}

function resolveEffortOption(
  model: ServerProviderModel | null,
  effort: string | undefined,
): ModelSelection["options"] {
  if (model === null || effort === undefined) return undefined;
  const descriptor = model.capabilities?.optionDescriptors?.find(
    (candidate) =>
      candidate.type === "select" &&
      (candidate.id === "effort" || candidate.id === "reasoningEffort") &&
      candidate.options.some((option) => option.id === effort),
  );
  return descriptor === undefined ? undefined : [{ id: descriptor.id, value: effort }];
}

/**
 * Resolve an agent recommendation against live provider state. The source
 * thread and project defaults are fallback routing hints, never availability
 * proof.
 */
export function resolveTaskSuggestionModelSelection(input: {
  readonly suggestion: TaskSuggestion;
  readonly sourceThread: OrchestrationThreadShell;
  readonly project: OrchestrationProjectShell;
  readonly providers: ReadonlyArray<ServerProvider>;
}): ModelSelection | null {
  const usableProviders = input.providers.filter(isUsableProvider);
  const recommendedProvider =
    input.suggestion.instanceId === undefined
      ? null
      : (usableProviders.find((provider) => provider.instanceId === input.suggestion.instanceId) ??
        null);
  const fallbackSelections = [
    input.sourceThread.modelSelection,
    input.project.defaultModelSelection,
  ] as const;
  const fallbackProvider = fallbackSelections
    .flatMap((selection) =>
      selection === null
        ? []
        : usableProviders.filter((provider) => provider.instanceId === selection.instanceId),
    )
    .at(0);
  const provider = recommendedProvider ?? fallbackProvider ?? usableProviders[0] ?? null;
  if (provider === null) return null;

  const fallbackSelection = matchingSelection(provider, fallbackSelections);
  const recommendationTargetsProvider =
    input.suggestion.instanceId === undefined ||
    input.suggestion.instanceId === provider.instanceId;
  const recommendedModel = recommendationTargetsProvider
    ? resolveRecommendedModel(provider, input.suggestion.model)
    : null;
  const recommendationAllowedWithoutCatalog =
    recommendationTargetsProvider &&
    provider.models.length === 0 &&
    input.suggestion.model !== undefined;
  const resolvedModel =
    recommendedModel !== null
      ? { model: recommendedModel.slug, capabilities: recommendedModel.capabilities }
      : recommendationAllowedWithoutCatalog
        ? { model: input.suggestion.model!, capabilities: null }
        : resolveDefaultModel(provider, fallbackSelection);
  if (resolvedModel === null) return null;

  const options =
    recommendedModel === null
      ? undefined
      : resolveEffortOption(recommendedModel, input.suggestion.effort);
  return createModelSelection(provider.instanceId, resolvedModel.model, options);
}
