import type { TaskSuggestion } from "@t3tools/contracts";
import { BotIcon } from "lucide-react";

import type { ProviderInstanceEntry } from "../../providerInstances";
import { cn } from "../../lib/utils";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  resolveTaskSuggestionCardState,
  taskSuggestionConcurrencyPresentation,
  taskSuggestionRecommendationLabel,
  type TaskSuggestionCardAction,
} from "./TaskSuggestionCard.logic";

interface TaskSuggestionCardProps {
  readonly suggestion: TaskSuggestion;
  readonly providerEntry: ProviderInstanceEntry | null;
  readonly busy?: boolean;
  readonly compact?: boolean;
  readonly onAccept: (suggestion: TaskSuggestion) => void;
  readonly onDismiss: (suggestion: TaskSuggestion) => void;
  readonly onOpen: (suggestion: TaskSuggestion) => void;
  readonly onRestore: (suggestion: TaskSuggestion) => void;
}

const ACTION_LABELS: Readonly<Record<TaskSuggestionCardAction, string>> = {
  accept: "Accept",
  dismiss: "Dismiss",
  open: "Open task",
  restore: "Restore",
};

export function TaskSuggestionCard(props: TaskSuggestionCardProps) {
  const { suggestion } = props;
  const state = resolveTaskSuggestionCardState(suggestion);
  const concurrency = taskSuggestionConcurrencyPresentation(suggestion);
  const recommendation = taskSuggestionRecommendationLabel(suggestion);
  const action = (kind: TaskSuggestionCardAction) => {
    switch (kind) {
      case "accept":
        props.onAccept(suggestion);
        return;
      case "dismiss":
        props.onDismiss(suggestion);
        return;
      case "open":
        props.onOpen(suggestion);
        return;
      case "restore":
        props.onRestore(suggestion);
    }
  };

  return (
    <article
      className={cn(
        "rounded-xl border border-border/70 bg-card/70 shadow-xs",
        props.compact ? "p-3" : "p-3.5",
      )}
      data-suggestion-id={suggestion.suggestionId}
      data-suggestion-status={suggestion.status}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="truncate text-sm font-semibold text-foreground">{suggestion.title}</h4>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {props.providerEntry ? (
              <ProviderInstanceIcon
                driverKind={props.providerEntry.driverKind}
                displayName={props.providerEntry.displayName}
                accentColor={props.providerEntry.accentColor}
                className="size-4"
                iconClassName="size-4"
              />
            ) : (
              <BotIcon className="size-4 shrink-0" aria-hidden />
            )}
            <span className="max-w-full truncate">
              {props.providerEntry?.displayName ?? suggestion.instanceId ?? "Default provider"}
            </span>
            <span aria-hidden>·</span>
            <span className="max-w-full truncate">{recommendation}</span>
          </div>
        </div>
        {state.statusLabel ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            {state.statusLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "inline-flex max-w-full cursor-help items-center rounded-full px-2 py-1 text-[11px] font-medium",
                  concurrency.warning
                    ? "bg-warning/12 text-warning-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              />
            }
          >
            <span className="truncate">{concurrency.label}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{concurrency.tooltip}</TooltipPopup>
        </Tooltip>

        <div className="ml-auto flex items-center gap-1.5">
          {state.secondaryAction ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={props.busy}
              onClick={() => action(state.secondaryAction!)}
            >
              {ACTION_LABELS[state.secondaryAction]}
            </Button>
          ) : null}
          {state.primaryAction ? (
            <Button
              type="button"
              size="xs"
              variant={state.primaryAction === "accept" ? "default" : "outline"}
              disabled={props.busy}
              onClick={() => action(state.primaryAction!)}
            >
              {props.busy ? "Working…" : ACTION_LABELS[state.primaryAction]}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
