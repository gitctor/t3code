import { SUGGESTIONS_WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createTaskSuggestionEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:task-suggestions:list",
    tag: SUGGESTIONS_WS_METHODS.list,
  });
  const refreshList = (
    target: { readonly environmentId: EnvironmentId },
    registry: AtomRegistry.AtomRegistry,
  ) =>
    Effect.sync(() => {
      registry.refresh(list({ environmentId: target.environmentId, input: {} }));
    });

  return {
    list,
    accept: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:task-suggestions:accept",
      tag: SUGGESTIONS_WS_METHODS.accept,
      onSettled: refreshList,
    }),
    dismiss: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:task-suggestions:dismiss",
      tag: SUGGESTIONS_WS_METHODS.dismiss,
      onSettled: refreshList,
    }),
    restore: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:task-suggestions:restore",
      tag: SUGGESTIONS_WS_METHODS.restore,
      onSettled: refreshList,
    }),
  };
}
