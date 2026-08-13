import { useAtomValue } from "@effect/atom-react";
import { CommonActions, useNavigation } from "@react-navigation/native";
import type { EnvironmentId, TaskSuggestion } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { EmptyState } from "../../components/EmptyState";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironments } from "../../state/environments";
import { taskSuggestionEnvironment } from "../../state/taskSuggestions";
import { useAtomCommand } from "../../state/use-atom-command";

function usePendingTaskSuggestions(environmentIds: ReadonlyArray<EnvironmentId>) {
  const atoms = useMemo(
    () =>
      environmentIds.map((environmentId) => ({
        environmentId,
        atom: taskSuggestionEnvironment.list({ environmentId, input: {} }),
      })),
    [environmentIds],
  );
  const combined = useMemo(
    () =>
      Atom.make((get) =>
        atoms.map(({ environmentId, atom }) => ({ environmentId, value: get(atom) })),
      ).pipe(Atom.withLabel("mobile:suggested-tasks")),
    [atoms],
  );
  const results = useAtomValue(combined);
  return useMemo(() => {
    const suggestions: TaskSuggestion[] = [];
    let loading = false;
    for (const result of results) {
      const value = Option.getOrNull(AsyncResult.value(result.value));
      suggestions.push(
        ...(value?.suggestions.filter((suggestion) => suggestion.status === "pending") ?? []),
      );
      loading ||= result.value.waiting;
    }
    return { suggestions, loading };
  }, [results]);
}

function errorMessage(result: AtomCommandResult<unknown, unknown>): string | null {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return null;
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "The suggested task could not be updated.";
}

export function SuggestedTasksRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { environments } = useEnvironments();
  const connectedEnvironmentIds = useMemo(
    () =>
      environments
        .filter((environment) => environment.connection.phase === "connected")
        .map((environment) => environment.environmentId),
    [environments],
  );
  const environmentLabelById = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const { suggestions, loading } = usePendingTaskSuggestions(connectedEnvironmentIds);
  const accept = useAtomCommand(taskSuggestionEnvironment.accept, {
    reportFailure: false,
  });
  const dismiss = useAtomCommand(taskSuggestionEnvironment.dismiss, {
    reportFailure: false,
  });
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const run = async (suggestion: TaskSuggestion, action: "accept" | "dismiss") => {
    setBusyIds((current) => new Set(current).add(suggestion.suggestionId));
    try {
      const target = {
        environmentId: suggestion.environmentId,
        input: { suggestionId: suggestion.suggestionId },
      };
      if (action === "accept") {
        const result = await accept(target);
        const message = errorMessage(result);
        if (message) {
          Alert.alert("Suggested task", message);
          return;
        }
        if (result._tag !== "Success") return;
        navigation.dispatch(
          CommonActions.navigate({
            name: "Thread",
            params: {
              environmentId: suggestion.environmentId,
              threadId: result.value.threadId,
            },
          }),
        );
        return;
      }
      const result = await dismiss(target);
      const message = errorMessage(result);
      if (message) Alert.alert("Suggested task", message);
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(suggestion.suggestionId);
        return next;
      });
    }
  };

  return (
    <View className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <>
          <NativeStackScreenOptions options={{ headerShown: false }} />
          <AndroidScreenHeader title="Suggested tasks" onBack={() => navigation.goBack()} />
        </>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        {suggestions.map((suggestion) => {
          const busy = busyIds.has(suggestion.suggestionId);
          return (
            <View key={suggestion.suggestionId} className="gap-3 rounded-2xl bg-subtle p-4">
              <View className="gap-1">
                <Text className="text-base font-t3-bold text-foreground" selectable>
                  {suggestion.title}
                </Text>
                <Text className="text-sm text-foreground-muted" selectable>
                  {environmentLabelById.get(suggestion.environmentId) ?? "Environment"}
                  {suggestion.model ? ` · ${suggestion.model}` : " · Default model"}
                </Text>
              </View>
              <Text
                className={
                  suggestion.concurrency === "run-solo"
                    ? "text-sm text-warning"
                    : "text-sm text-foreground-muted"
                }
                selectable
              >
                {suggestion.concurrency === "run-solo"
                  ? "Run solo — touches shared state"
                  : "Parallel-safe"}
                {suggestion.soloReason ? ` — ${suggestion.soloReason}` : ""}
              </Text>
              <View className="flex-row justify-end gap-2">
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void run(suggestion, "dismiss")}
                  className="rounded-full px-4 py-2 disabled:opacity-50"
                >
                  <Text className="font-t3-bold text-foreground">Dismiss</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void run(suggestion, "accept")}
                  className="rounded-full bg-primary px-4 py-2 disabled:opacity-50"
                >
                  <Text className="font-t3-bold text-primary-foreground">
                    {busy ? "Working…" : "Accept"}
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        })}
        {suggestions.length === 0 ? (
          <EmptyState
            title={loading ? "Loading suggested tasks" : "No suggested tasks"}
            detail="Agents can propose self-contained follow-up work after a turn."
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
