// @effect-diagnostics nodeBuiltinImport:off
/**
 * Historical recovery for account limits.
 *
 * Codex writes its full rate-limit snapshot beside every `token_count` line in
 * `~/.codex/sessions/**\/*.jsonl`, so the latest snapshot survives on disk even
 * when no session has run through T3 Code. T3 also persists canonical
 * `account.rate-limits.updated` events for every provider in rotating,
 * per-thread event logs. Those logs are the restart-safe source for Claude and
 * any future adapter that reports the same canonical event.
 *
 * Only file tails are read: the newest lines carry the newest snapshot, and a
 * session file can be tens of megabytes. Direct `node:fs` is deliberate, same
 * as `usageTranscriptReader`: this is bulk raw-file access on a request path.
 *
 * @module accountLimitsTranscripts
 */
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import type { Dirent } from "node:fs";

import {
  codexSnapshotFromUnknown,
  isPrimaryCodexLimit,
  type CodexRateLimitsSnapshot,
} from "./accountLimitsNormalize.ts";
import { listTranscriptFiles } from "./usageTranscriptReader.ts";

const TAIL_BYTES = 256 * 1024;
const SCAN_WINDOW_DAYS = 14;
/**
 * Newest-first cutoff bounding the scan on the RPC path. The newest file
 * almost always hits; the margin covers runs of files without a main-meter
 * snapshot (Spark-only sessions, sessions abandoned before any token count).
 * If this many consecutive files lack one, the data is genuinely absent.
 */
const MAX_FILES = 32;
const MAX_PROVIDER_LOG_FILES = 64;

export interface LoggedAccountLimits {
  readonly provider: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface CodexTranscriptRateLimits {
  readonly snapshot: CodexRateLimitsSnapshot;
  readonly asOfMs: number;
}

/**
 * Reads the newest canonical rate-limit event per provider from T3's rotating
 * provider logs. `providerEventLogPath` is the configured base (`events.log`),
 * while the logger writes `events.<threadId>.log` and numbered rotations.
 */
export async function readLatestLoggedAccountLimits(
  providerEventLogPath: string,
  nowMs: number,
): Promise<ReadonlyArray<LoggedAccountLimits>> {
  const directory = NodePath.dirname(providerEventLogPath);
  const baseName = NodePath.basename(providerEventLogPath, ".log");
  const cutoffMs = nowMs - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let entries: ReadonlyArray<Dirent>;
  try {
    entries = await NodeFSP.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = (
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            (entry.name === `${baseName}.log` || entry.name.startsWith(`${baseName}.`)) &&
            /\.log(?:\.\d+)?$/.test(entry.name),
        )
        .map(async (entry) => {
          const filePath = NodePath.join(directory, entry.name);
          try {
            const stat = await NodeFSP.stat(filePath);
            return stat.mtimeMs >= cutoffMs ? { path: filePath, mtimeMs: stat.mtimeMs } : null;
          } catch {
            return null;
          }
        }),
    )
  )
    .filter((file): file is { readonly path: string; readonly mtimeMs: number } => file !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_PROVIDER_LOG_FILES);

  const latest = new Map<string, LoggedAccountLimits>();
  for (const file of files) {
    const records = await readTailLoggedAccountLimits(file.path);
    for (const record of records) {
      const previous = latest.get(record.provider);
      if (previous === undefined || previous.createdAt < record.createdAt) {
        latest.set(record.provider, record);
      }
    }
  }
  return [...latest.values()];
}

export async function readLatestCodexRateLimits(
  sessionsDir: string,
  nowMs: number,
): Promise<CodexTranscriptRateLimits | null> {
  let files;
  try {
    files = await listTranscriptFiles(sessionsDir, nowMs - SCAN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  } catch {
    return null;
  }
  const newestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_FILES);
  // The newest-mtime file does not necessarily hold the newest snapshot: a
  // session can keep appending non-token events after its last rate-limit
  // line. A file's snapshot can never be newer than the file's mtime, so
  // keep scanning only while a remaining file's mtime could still beat the
  // best snapshot found - which usually stops after one or two files.
  let best: CodexTranscriptRateLimits | null = null;
  for (const file of newestFirst) {
    if (best !== null && file.mtimeMs <= best.asOfMs) break;
    const found = await readTailRateLimits(file.path, file.mtimeMs);
    if (found !== null && (best === null || found.asOfMs > best.asOfMs)) best = found;
  }
  return best;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readTailRateLimits(
  filePath: string,
  mtimeMs: number,
): Promise<CodexTranscriptRateLimits | null> {
  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(filePath, "r");
  } catch {
    return null;
  }
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const length = stat.size - start;
    if (length <= 0) return null;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    // The first line may be cut mid-record by the tail offset; JSON.parse
    // rejects it and the scan moves on.
    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line || !line.includes('"rate_limits"')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(parsed)) continue;
      const payload = isRecord(parsed.payload) ? parsed.payload : null;
      if (!payload) continue;
      const snapshot = codexSnapshotFromUnknown(payload.rate_limits);
      // Side meters (Spark) write their own snapshot lines; keep scanning
      // back for the main meter.
      if (!snapshot || !isPrimaryCodexLimit(snapshot.limitId) || snapshot.windows.length === 0) {
        continue;
      }
      const timestamp =
        typeof parsed.timestamp === "string" ? Date.parse(parsed.timestamp) : Number.NaN;
      return { snapshot, asOfMs: Number.isFinite(timestamp) ? timestamp : mtimeMs };
    }
    return null;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}

async function readTailLoggedAccountLimits(
  filePath: string,
): Promise<ReadonlyArray<LoggedAccountLimits>> {
  let handle: NodeFSP.FileHandle;
  try {
    handle = await NodeFSP.open(filePath, "r");
  } catch {
    return [];
  }
  try {
    const stat = await handle.stat();
    const start = Math.max(0, stat.size - TAIL_BYTES);
    const length = stat.size - start;
    if (length <= 0) return [];
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);

    const records: LoggedAccountLimits[] = [];
    const seenProviders = new Set<string>();
    const lines = buffer.toString("utf8").split("\n");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line?.includes("CANON:") || !line.includes('"account.rate-limits.updated"')) continue;
      const jsonStart = line.indexOf("CANON:") + "CANON:".length;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line.slice(jsonStart).trim());
      } catch {
        continue;
      }
      if (!isRecord(parsed) || parsed.type !== "account.rate-limits.updated") continue;
      if (typeof parsed.provider !== "string" || typeof parsed.createdAt !== "string") continue;
      if (seenProviders.has(parsed.provider)) continue;
      const payload = isRecord(parsed.payload) ? parsed.payload.rateLimits : undefined;
      if (payload === undefined) continue;
      seenProviders.add(parsed.provider);
      records.push({ provider: parsed.provider, payload, createdAt: parsed.createdAt });
    }
    return records;
  } catch {
    return [];
  } finally {
    await handle.close().catch(() => {});
  }
}
