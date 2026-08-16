/**
 * Account rate-limit views: the composer capacity cluster, the sidebar
 * hover card, and the usage page's "Limits" strip. They render whatever
 * windows the server reports, so a
 * window a provider adds or brings back (Codex's paused 5-hour) appears
 * without a client change.
 *
 * Every percentage is labelled `left` inline - a bare number cannot say
 * whether it is used or remaining. Snapshot age only renders once the data
 * is actually stale; fresh data needs no caption.
 *
 * @module AccountLimits
 */
import type {
  AccountLimitsSnapshot,
  AccountLimitsWindow,
  UsageProviderKind,
} from "@t3tools/contracts";
import { formatAgo, formatResetAt, formatSidebarResetAt } from "@t3tools/shared/limitsFormat";
import { useEffect, useRef } from "react";

import { cn } from "../../lib/utils";
import { useAccountLimits } from "../../state/accountLimits";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  ACCOUNT_LIMIT_PROVIDER_COLOR,
  ACCOUNT_LIMIT_PROVIDER_LABEL,
  ACCOUNT_LIMIT_PROVIDER_MARK,
  ACCOUNT_LIMIT_PROVIDER_ORDER,
  accountLimitEmptyStateCopy,
  PROVIDER_LABEL,
  PROVIDER_MARK,
  PROVIDER_ORDER,
} from "./usageProviders";

/** Age past which a snapshot stops being "current" and earns a caption. */
const STALE_AFTER_MS = 15 * 60_000;

/** One interaction-driven refresh per card/strip mount; never a polling loop. */
function useRefreshLimitsOnMount(refresh: () => void) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    refreshRef.current();
  }, []);
}

export function accountLimitPercentLeft(usedPercent: number): number {
  if (!Number.isFinite(usedPercent)) return 0;
  return Math.min(100, Math.max(0, 100 - usedPercent));
}

export function formatAccountLimitPercentLeft(usedPercent: number): string {
  return `${Math.round(accountLimitPercentLeft(usedPercent))}% left`;
}

function remainingTone(percentLeft: number): string {
  if (percentLeft <= 5) return "text-red-400";
  if (percentLeft <= 20) return "text-amber-400";
  return "text-foreground/70";
}

function compactWindowLabel(window: AccountLimitsWindow): string {
  if (window.windowMinutes === null) return window.label;
  if (window.windowMinutes % 1_440 === 0) return `${window.windowMinutes / 1_440}d`;
  if (window.windowMinutes % 60 === 0) return `${window.windowMinutes / 60}h`;
  return `${window.windowMinutes}m`;
}

function LimitMeter({ window, color }: { window: AccountLimitsWindow; color: string }) {
  const percentLeft = accountLimitPercentLeft(window.usedPercent);
  return (
    <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full"
        style={{
          width: `${percentLeft}%`,
          backgroundColor: color,
        }}
      />
    </div>
  );
}

/** `6h ago`, and only once the snapshot is old enough to matter. */
function SnapshotAge({ snapshot, nowMs }: { snapshot: AccountLimitsSnapshot; nowMs: number }) {
  const ageMs = nowMs - Date.parse(snapshot.asOf);
  if (!Number.isFinite(ageMs) || ageMs < STALE_AFTER_MS) return null;
  return (
    <span className="text-[10px] text-muted-foreground">{formatAgo(snapshot.asOf, nowMs)}</span>
  );
}

/** Remaining provider capacity beside the chat context-window meter. */
export function AccountLimitsComposerGauges() {
  const { readAtMs, snapshots } = useAccountLimits();

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {PROVIDER_ORDER.map((provider) => {
        const snapshot = snapshots.get(provider);
        if (snapshot === undefined || snapshot.windows.length === 0) return null;
        return (
          <AccountLimitsComposerGauge
            key={provider}
            nowMs={readAtMs}
            provider={provider}
            snapshot={snapshot}
          />
        );
      })}
    </span>
  );
}

function AccountLimitsComposerGauge({
  nowMs,
  provider,
  snapshot,
}: {
  nowMs: number;
  provider: UsageProviderKind;
  snapshot: AccountLimitsSnapshot;
}) {
  const Mark = PROVIDER_MARK[provider];
  const windows = snapshot.windows.slice(0, 2);
  const ariaLabel = `${PROVIDER_LABEL[provider]}: ${windows
    .map(
      (window) =>
        `${compactWindowLabel(window)} ${Math.round(accountLimitPercentLeft(window.usedPercent))} percent left`,
    )
    .join(", ")}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={ariaLabel}
            className="relative inline-flex size-7 shrink-0 items-center justify-center"
            role="img"
          />
        }
      >
        <svg aria-hidden="true" className="absolute inset-0 size-7 -rotate-90" viewBox="0 0 32 32">
          {windows.map((window, index) => {
            const radius = index === 0 ? 13.5 : 10;
            const percentLeft = accountLimitPercentLeft(window.usedPercent);
            return (
              <g key={window.id}>
                <circle
                  className="text-muted-foreground/30"
                  cx="16"
                  cy="16"
                  fill="none"
                  pathLength="100"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="2"
                />
                {percentLeft > 0 ? (
                  <circle
                    className={remainingTone(percentLeft)}
                    cx="16"
                    cy="16"
                    fill="none"
                    pathLength="100"
                    r={radius}
                    stroke="currentColor"
                    strokeDasharray={`${percentLeft} ${100 - percentLeft}`}
                    strokeLinecap="round"
                    strokeWidth="2"
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
        <Mark className="relative size-2.5" />
      </TooltipTrigger>
      <TooltipPopup align="end" className="min-w-44" side="top" sideOffset={6}>
        <div className="flex flex-col gap-1.5 py-1">
          <div className="font-medium text-popover-foreground">{PROVIDER_LABEL[provider]}</div>
          {windows.map((window, index) => (
            <div key={window.id} className="grid grid-cols-[1fr_auto] gap-x-3">
              <span className="text-muted-foreground">
                {index === 0 ? "Outer" : "Inner"} · {compactWindowLabel(window)}
              </span>
              <span
                className={cn(
                  "font-medium tabular-nums",
                  remainingTone(accountLimitPercentLeft(window.usedPercent)),
                )}
              >
                {formatAccountLimitPercentLeft(window.usedPercent)}
              </span>
              <span className="col-span-2 text-[10px] text-muted-foreground/80">
                {formatSidebarResetAt(window.resetsAt, nowMs)}
              </span>
            </div>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Sidebar hover card
// ---------------------------------------------------------------------------

/** Compact per-provider availability, shown on hovering the Usage button. */
export function AccountLimitsHoverCard() {
  const { snapshots, isPending, isSettling, readAtMs, refresh } = useAccountLimits();
  useRefreshLimitsOnMount(refresh);

  if (isPending && snapshots.size === 0) {
    return <p className="px-1 py-2 text-xs text-muted-foreground">Loading limits…</p>;
  }

  return (
    <div className="flex w-64 flex-col gap-2.5 p-1.5">
      {ACCOUNT_LIMIT_PROVIDER_ORDER.map((provider) => {
        const snapshot =
          provider === "kimi" || provider === "ollama" ? undefined : snapshots.get(provider);
        const Mark = ACCOUNT_LIMIT_PROVIDER_MARK[provider];
        return (
          <div key={provider} className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
              <Mark className="size-3 shrink-0 self-center" />
              <span className="text-xs font-medium text-foreground">
                {ACCOUNT_LIMIT_PROVIDER_LABEL[provider]}
              </span>
              <span className="ml-auto">
                {snapshot !== undefined ? (
                  <SnapshotAge snapshot={snapshot} nowMs={readAtMs} />
                ) : null}
              </span>
            </div>
            {snapshot === undefined || snapshot.windows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {accountLimitEmptyStateCopy(provider, snapshot === undefined && isSettling)}
              </p>
            ) : (
              snapshot.windows.map((window) => (
                <div key={window.id} className="flex items-center gap-2">
                  <span className="w-9 shrink-0 text-[10px] text-muted-foreground">
                    {window.label}
                  </span>
                  <LimitMeter window={window} color={ACCOUNT_LIMIT_PROVIDER_COLOR[provider]} />
                  <span
                    className={cn(
                      "shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums",
                      remainingTone(accountLimitPercentLeft(window.usedPercent)),
                    )}
                  >
                    {formatAccountLimitPercentLeft(window.usedPercent)}
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-right text-[10px] tabular-nums text-muted-foreground">
                    {formatResetAt(window.resetsAt, readAtMs) ?? ""}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usage page section
// ---------------------------------------------------------------------------

/** The "Limits" strip above the analytics: one column per provider. */
export function AccountLimitsSection() {
  const { snapshots, isSettling, readAtMs, refresh } = useAccountLimits();
  useRefreshLimitsOnMount(refresh);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-foreground">Limits</h2>
      <div className="grid gap-x-12 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {ACCOUNT_LIMIT_PROVIDER_ORDER.map((provider) => {
          const snapshot =
            provider === "kimi" || provider === "ollama" ? undefined : snapshots.get(provider);
          const Mark = ACCOUNT_LIMIT_PROVIDER_MARK[provider];
          return (
            <div key={provider} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-2">
                <Mark className="size-3.5 shrink-0 self-center" />
                <span className="text-sm font-medium text-foreground">
                  {ACCOUNT_LIMIT_PROVIDER_LABEL[provider]}
                </span>
                <span className="ml-auto">
                  {snapshot !== undefined ? (
                    <SnapshotAge snapshot={snapshot} nowMs={readAtMs} />
                  ) : null}
                </span>
              </div>
              {snapshot === undefined || snapshot.windows.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {accountLimitEmptyStateCopy(provider, snapshot === undefined && isSettling)}
                </p>
              ) : (
                snapshot.windows.map((window) => {
                  const resetAt = formatResetAt(window.resetsAt, readAtMs);
                  return (
                    <div key={window.id} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-xs text-muted-foreground">
                        {window.label}
                      </span>
                      <LimitMeter window={window} color={ACCOUNT_LIMIT_PROVIDER_COLOR[provider]} />
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap text-right text-xs font-medium tabular-nums",
                          remainingTone(accountLimitPercentLeft(window.usedPercent)),
                        )}
                      >
                        {formatAccountLimitPercentLeft(window.usedPercent)}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                        {resetAt === null ? "" : `resets ${resetAt}`}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
