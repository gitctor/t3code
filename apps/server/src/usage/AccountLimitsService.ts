/**
 * AccountLimitsService - the server-wide account rate-limit cache.
 *
 * Fed passively: runtime ingestion forwards every
 * `account.rate-limits.updated` event here (Claude usage snapshots and
 * single-window events, Codex app-server notifications), so the cache costs
 * nothing while sessions run. At startup it recovers canonical limit events
 * from T3's rotating provider logs, then uses Codex's own session transcripts
 * as an extra fallback. Reads also ask live adapters for a fresh snapshot when
 * their protocol supports it.
 *
 * One snapshot per provider: T3 Code drives one account per provider today.
 *
 * @module AccountLimitsService
 */
import {
  ACCOUNT_LIMITS_CONTRACT_VERSION,
  AccountLimitsSnapshot,
  type AccountLimitsSummary,
  type UsageProviderKind,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import { writeFileStringAtomically } from "../atomicWrite.ts";
import { ServerConfig } from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import { resolveCodexHomeLayout } from "../provider/Drivers/CodexHomeLayout.ts";
import {
  claudeUsageSnapshotFromUnknown,
  claudeWindowFromRateLimitEvent,
  codexSnapshotFromUnknown,
  isPrimaryCodexLimit,
  sortWindows,
} from "./accountLimitsNormalize.ts";
import {
  readLatestCodexRateLimits,
  readLatestLoggedAccountLimits,
} from "./accountLimitsTranscripts.ts";

/** Failed or empty history scans are not retried more often than this. */
const HISTORY_SEED_MIN_INTERVAL_MS = 60_000;

/** On-disk shape of the snapshot cache: the contract array, JSON-encoded. */
const LimitsCacheFile = Schema.Array(AccountLimitsSnapshot);
const decodeLimitsCache = Schema.decodeUnknownEffect(
  Schema.fromJsonString(LimitsCacheFile as unknown as Schema.Codec<typeof LimitsCacheFile.Type>),
);
const encodeLimitsCache = Schema.encodeEffect(
  Schema.fromJsonString(LimitsCacheFile as unknown as Schema.Codec<typeof LimitsCacheFile.Type>),
);

export interface AccountLimitsIngestInput {
  /** Driver kind off the runtime event (`claudeAgent`, `codex`, ...). */
  readonly provider: string;
  /** The event's `payload.rateLimits`, in whatever shape the adapter emitted. */
  readonly payload: unknown;
  readonly createdAt: string;
}

/** Mutable hook that keeps the cache independent from provider-layer wiring. */
export function makeAccountLimitsLiveRefreshTrigger() {
  let current: () => Effect.Effect<void> = () => Effect.void;
  return {
    register(refresh: () => Effect.Effect<void>) {
      current = refresh;
    },
    run: () => current(),
  } as const;
}

export class AccountLimitsService extends Context.Service<
  AccountLimitsService,
  {
    readonly readSummary: () => Effect.Effect<AccountLimitsSummary>;
    readonly ingest: (input: AccountLimitsIngestInput) => Effect.Effect<void>;
    /** Runtime ingestion installs the live-adapter pull without a layer cycle. */
    readonly registerLiveRefresh?: (refresh: () => Effect.Effect<void>) => Effect.Effect<void>;
  }
>()("t3/usage/AccountLimitsService") {}

/** Empty cache, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  AccountLimitsService,
  AccountLimitsService.of({
    readSummary: () =>
      Effect.succeed({
        contractVersion: ACCOUNT_LIMITS_CONTRACT_VERSION,
        readAt: "1970-01-01T00:00:00.000Z",
        snapshots: [],
      }),
    ingest: () => Effect.void,
  }),
);

function providerFromDriver(driver: string): UsageProviderKind | null {
  if (driver === "claudeAgent") return "claude";
  if (driver === "codex") return "codex";
  return null;
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig;
  const settingsService = yield* ServerSettings.ServerSettingsService;

  const snapshots = new Map<UsageProviderKind, AccountLimitsSnapshot>();
  const cachePath = path.join(config.stateDir, "account-limits.json");
  let lastHistorySeedAttemptAtMs = Number.NEGATIVE_INFINITY;
  const liveRefresh = makeAccountLimitsLiveRefreshTrigger();

  // Restarts must not lose the Claude snapshot (stream-only, no disk source),
  // so the cache is persisted. Same Effect.cached trick as the usage scan
  // cache: concurrent first readers await one load.
  const ensureLoaded = yield* Effect.cached(
    Effect.gen(function* () {
      const stored = yield* fileSystem.readFileString(cachePath).pipe(
        Effect.flatMap((raw) => decodeLimitsCache(raw)),
        Effect.catchCause(() => Effect.succeed(null)),
      );
      if (stored === null) return;
      for (const snapshot of stored) {
        if (!snapshots.has(snapshot.provider)) snapshots.set(snapshot.provider, snapshot);
      }
    }),
  );

  /**
   * All snapshot mutations - event ingest (worker fiber) and the transcript
   * seed (RPC fiber) - run under this one permit, so each ordering guard,
   * map write, and persist is atomic with respect to the others. Without it
   * a concurrent pair can both pass their guard against the same prior
   * snapshot and land in either order, rolling the state backwards. Reads
   * stay lock-free.
   */
  const stateLock = yield* Semaphore.make(1);

  // A cache we cannot write is a colder next start, not a failure. Only
  // called while holding `stateLock`, which is what serializes writes; the
  // temp-file + rename keeps a crashed write from tearing the file.
  const persist = Effect.fn("AccountLimitsService.persist")(function* () {
    yield* encodeLimitsCache([...snapshots.values()]).pipe(
      Effect.flatMap((serialized) =>
        writeFileStringAtomically({ filePath: cachePath, contents: serialized }),
      ),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.catchCause(() => Effect.void),
    );
  });

  const store = Effect.fn("AccountLimitsService.store")(function* (
    snapshot: AccountLimitsSnapshot,
  ) {
    snapshots.set(snapshot.provider, snapshot);
    yield* persist();
  });

  const ingestClaude = Effect.fn("AccountLimitsService.ingestClaude")(function* (
    payload: unknown,
    createdAt: string,
    source: AccountLimitsSnapshot["source"],
  ) {
    const previous = snapshots.get("claude");
    const full = claudeUsageSnapshotFromUnknown(payload);
    if (full !== null) {
      // Rate limits do not apply to this account (API key / Bedrock / Vertex):
      // nothing to show, and nothing worth clearing a previous snapshot over.
      if (full.windows.length === 0) return;
      yield* store({
        provider: "claude",
        plan: full.plan ?? previous?.plan ?? null,
        windows: full.windows,
        asOf: createdAt,
        source,
      });
      return;
    }
    // The streamed event names one window; patch it into whatever set the
    // last full snapshot established.
    const window = claudeWindowFromRateLimitEvent(payload);
    if (window === null) return;
    const windows = sortWindows([
      ...(previous?.windows ?? []).filter((existing) => existing.id !== window.id),
      window,
    ]);
    yield* store({
      provider: "claude",
      plan: previous?.plan ?? null,
      windows,
      asOf: createdAt,
      source,
    });
  });

  const ingestCodex = Effect.fn("AccountLimitsService.ingestCodex")(function* (
    payload: unknown,
    createdAt: string,
    source: AccountLimitsSnapshot["source"],
  ) {
    const snapshot = codexSnapshotFromUnknown(payload);
    if (snapshot === null) return;
    // Per-model side meters (Spark) are not surfaced.
    if (!isPrimaryCodexLimit(snapshot.limitId)) return;
    if (snapshot.windows.length === 0) return;
    const previous = snapshots.get("codex");
    yield* store({
      provider: "codex",
      plan: snapshot.plan ?? previous?.plan ?? null,
      windows: snapshot.windows,
      asOf: createdAt,
      source,
    });
  });

  const ingestWithSource = Effect.fn("AccountLimitsService.ingestWithSource")(function* (
    input: AccountLimitsIngestInput,
    source: AccountLimitsSnapshot["source"],
  ) {
    const provider = providerFromDriver(input.provider);
    if (provider === null) return;
    yield* ensureLoaded;
    yield* stateLock.withPermits(1)(
      Effect.gen(function* () {
        // Guard against out-of-order delivery: an event older than what is
        // already stored must not roll the snapshot backwards.
        const existing = snapshots.get(provider);
        if (existing !== undefined && input.createdAt < existing.asOf) return;
        if (provider === "claude") {
          yield* ingestClaude(input.payload, input.createdAt, source);
        } else {
          yield* ingestCodex(input.payload, input.createdAt, source);
        }
      }),
    );
  });

  const ingest = (input: AccountLimitsIngestInput) => ingestWithSource(input, "live");

  /**
   * Recovers the Codex snapshot from session transcripts when they are newer
   * than what the cache holds - which covers both a cold cache and Codex
   * sessions driven outside T3 Code.
   */
  const maybeSeedFromHistory = Effect.fn("AccountLimitsService.seedHistory")(function* (
    nowMs: number,
  ) {
    if (nowMs - lastHistorySeedAttemptAtMs < HISTORY_SEED_MIN_INTERVAL_MS) return;
    lastHistorySeedAttemptAtMs = nowMs;

    const logged = yield* Effect.promise(() =>
      readLatestLoggedAccountLimits(config.providerEventLogPath, nowMs),
    );
    yield* Effect.forEach(logged, (record) => ingestWithSource(record, "transcript"), {
      concurrency: 1,
      discard: true,
    });

    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (settings === null) return;
    const layout = yield* resolveCodexHomeLayout(settings.providers.codex).pipe(
      Effect.provideService(Path.Path, path),
    );
    const sessionsDir = path.join(layout.sharedHomePath, "sessions");
    const found = yield* Effect.promise(() => readLatestCodexRateLimits(sessionsDir, nowMs));
    if (found === null) return;

    const asOf = DateTime.formatIso(DateTime.makeUnsafe(found.asOfMs));
    // The slow transcript read happened outside the lock; only the
    // guard-and-store is serialized against live ingests.
    yield* stateLock.withPermits(1)(
      Effect.gen(function* () {
        const existing = snapshots.get("codex");
        // ISO-8601 strings order lexicographically.
        if (existing !== undefined && existing.asOf >= asOf) return;
        yield* store({
          provider: "codex",
          plan: found.snapshot.plan ?? existing?.plan ?? null,
          windows: found.snapshot.windows,
          asOf,
          source: "transcript",
        });
      }),
    );
  });

  const readSummary = Effect.fn("AccountLimitsService.readSummary")(function* () {
    yield* ensureLoaded;
    const seedNowMs = yield* Clock.currentTimeMillis;
    yield* maybeSeedFromHistory(seedNowMs).pipe(Effect.catchCause(() => Effect.void));
    yield* liveRefresh.run().pipe(Effect.catchCause(() => Effect.void));
    const readAtMs = yield* Clock.currentTimeMillis;
    return {
      contractVersion: ACCOUNT_LIMITS_CONTRACT_VERSION,
      readAt: DateTime.formatIso(DateTime.makeUnsafe(readAtMs)),
      snapshots: [...snapshots.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
    } satisfies AccountLimitsSummary;
  });

  // Seed during layer construction so the first connected client receives
  // historical limits without needing to open Usage first.
  yield* ensureLoaded;
  const startupNowMs = yield* Clock.currentTimeMillis;
  yield* maybeSeedFromHistory(startupNowMs).pipe(Effect.catchCause(() => Effect.void));

  const registerLiveRefresh = (refresh: () => Effect.Effect<void>) =>
    Effect.sync(() => {
      liveRefresh.register(refresh);
    });

  return { readSummary, ingest, registerLiveRefresh } as const;
});

export const layer = Layer.effect(AccountLimitsService, make);
