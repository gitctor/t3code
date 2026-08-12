/**
 * Multi-environment account-limits state.
 *
 * Every connected environment reports its cached snapshot per provider; the
 * client keeps the freshest one per provider. Environments on the same
 * machine answer with identical data, so freshest-wins is also the dedupe.
 *
 * @module state/accountLimits
 */
import { useAtomValue } from "@effect/atom-react";
import {
  ACCOUNT_LIMITS_CONTRACT_VERSION,
  type AccountLimitsSnapshot,
  type EnvironmentId,
  type UsageProviderKind,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

interface EnvironmentLimitsStatus {
  readonly environmentId: EnvironmentId;
  readonly isPending: boolean;
  readonly readAt: string | null;
  readonly snapshots: readonly AccountLimitsSnapshot[] | null;
}

const accountLimitsAtom = Atom.make((get): readonly EnvironmentLimitsStatus[] => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const statuses: EnvironmentLimitsStatus[] = [];
  for (const [environmentId] of presentations) {
    const result = get(serverEnvironment.accountLimits({ environmentId, input: {} }));
    const summary = Option.getOrNull(AsyncResult.value(result));
    const validSummary =
      summary !== null && summary.contractVersion === ACCOUNT_LIMITS_CONTRACT_VERSION
        ? summary
        : null;
    statuses.push({
      environmentId,
      isPending: result.waiting,
      readAt: validSummary?.readAt ?? null,
      snapshots: validSummary?.snapshots ?? null,
    });
  }
  return statuses;
}).pipe(Atom.withLabel("web-account-limits"));

export interface AccountLimitsView {
  /** Freshest snapshot per provider, in no particular order. */
  readonly snapshots: ReadonlyMap<UsageProviderKind, AccountLimitsSnapshot>;
  /** True until at least one environment has answered. */
  readonly isPending: boolean;
  /**
   * True while any environment is still answering. A provider with no
   * snapshot is "loading" while this holds and "no data" once it clears -
   * the first environment to answer must not decide that for the rest.
   */
  readonly isSettling: boolean;
  /** Latest server read time, used for static reset and freshness labels. */
  readonly readAtMs: number;
  readonly refresh: () => void;
}

export function useAccountLimits(): AccountLimitsView {
  const environments = useAtomValue(accountLimitsAtom);

  const snapshots = useMemo(() => {
    const freshest = new Map<UsageProviderKind, AccountLimitsSnapshot>();
    for (const environment of environments) {
      for (const snapshot of environment.snapshots ?? []) {
        const current = freshest.get(snapshot.provider);
        // ISO-8601 strings order lexicographically.
        if (current === undefined || snapshot.asOf > current.asOf) {
          freshest.set(snapshot.provider, snapshot);
        }
      }
    }
    return freshest;
  }, [environments]);

  const readAtMs = environments.reduce((latest, environment) => {
    if (environment.readAt === null) return latest;
    const parsed = Date.parse(environment.readAt);
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);

  const refresh = useCallback(() => {
    for (const environment of environments) {
      appAtomRegistry.refresh(
        serverEnvironment.accountLimits({ environmentId: environment.environmentId, input: {} }),
      );
    }
  }, [environments]);

  const answered = environments.filter((environment) => environment.snapshots !== null).length;
  const stillReporting = environments.filter(
    (environment) => environment.snapshots === null && environment.isPending,
  ).length;

  return {
    snapshots,
    isPending: answered === 0 && stillReporting > 0,
    isSettling: stillReporting > 0,
    readAtMs,
    refresh,
  };
}
