import type { EnvironmentId, TaskSuggestion } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { TaskSuggestionCard } from "./TaskSuggestionCard";

export function TaskSuggestionsPopover(props: {
  readonly suggestions: ReadonlyArray<TaskSuggestion>;
  readonly busySuggestionIds: ReadonlySet<string>;
  readonly providerEntryByInstanceId: ReadonlyMap<string, ProviderInstanceEntry>;
  readonly environmentIds?: ReadonlySet<EnvironmentId> | null;
  readonly onAccept: (suggestion: TaskSuggestion) => void;
  readonly onDismiss: (suggestion: TaskSuggestion) => void;
  readonly onOpen: (suggestion: TaskSuggestion) => void;
  readonly onRestore: (suggestion: TaskSuggestion) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "dismissed">("pending");
  const scoped = useMemo(
    () =>
      props.suggestions.filter(
        (suggestion) =>
          suggestion.status === filter &&
          (props.environmentIds == null || props.environmentIds.has(suggestion.environmentId)),
      ),
    [filter, props.environmentIds, props.suggestions],
  );
  const pendingCount = props.suggestions.filter(
    (suggestion) =>
      suggestion.status === "pending" &&
      (props.environmentIds == null || props.environmentIds.has(suggestion.environmentId)),
  ).length;

  if (pendingCount === 0 && filter === "pending") {
    const hasDismissed = props.suggestions.some(
      (suggestion) =>
        suggestion.status === "dismissed" &&
        (props.environmentIds == null || props.environmentIds.has(suggestion.environmentId)),
    );
    if (!hasDismissed) return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="inline-flex h-5 shrink-0 items-center rounded-full bg-sidebar-accent px-2 text-[11px] font-semibold text-sidebar-foreground outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label={`${pendingCount} suggested tasks`}
          />
        }
      >
        {pendingCount > 0 ? pendingCount : "Suggested"}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-[min(24rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
          <h2 className="text-sm font-semibold">Suggested tasks</h2>
          <div className="flex gap-1">
            <Button
              size="xs"
              variant={filter === "pending" ? "secondary" : "ghost"}
              onClick={() => setFilter("pending")}
            >
              Pending
            </Button>
            <Button
              size="xs"
              variant={filter === "dismissed" ? "secondary" : "ghost"}
              onClick={() => setFilter("dismissed")}
            >
              Dismissed
            </Button>
          </div>
        </div>
        <div className="max-h-[min(32rem,70vh)] overflow-y-auto p-2.5">
          {scoped.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              No {filter} suggestions
            </p>
          ) : (
            <div className="grid gap-2">
              {scoped.map((suggestion) => (
                <TaskSuggestionCard
                  key={suggestion.suggestionId}
                  compact
                  suggestion={suggestion}
                  providerEntry={
                    suggestion.instanceId === undefined
                      ? null
                      : (props.providerEntryByInstanceId.get(suggestion.instanceId) ?? null)
                  }
                  busy={props.busySuggestionIds.has(suggestion.suggestionId)}
                  onAccept={props.onAccept}
                  onDismiss={props.onDismiss}
                  onOpen={props.onOpen}
                  onRestore={props.onRestore}
                />
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
