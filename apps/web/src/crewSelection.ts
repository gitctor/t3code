import {
  CrewId,
  type Crew,
  type CrewUnavailableReason,
  type ResolvedCrew,
} from "@t3tools/contracts";

import type { ProviderInstanceEntry } from "./providerInstances";

export const CREW_UNAVAILABLE_COPY: Readonly<Record<CrewUnavailableReason, string>> = {
  "planner-instance-missing": "Planner not installed",
  "planner-instance-unavailable": "Planner is signed out or unavailable",
  "no-available-members": "No crew members are available",
};

export function isCrewInstanceReady(entry: ProviderInstanceEntry | undefined): boolean {
  return Boolean(
    entry &&
    entry.enabled &&
    entry.installed &&
    entry.isAvailable &&
    entry.status === "ready" &&
    entry.snapshot.auth.status !== "unauthenticated",
  );
}

export function resolveCrewForEntries(
  crew: Crew,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ResolvedCrew {
  const byId = new Map(entries.map((entry) => [entry.instanceId, entry]));
  return {
    crew,
    plannerAvailable: isCrewInstanceReady(byId.get(crew.planner.instanceId)),
    availableMemberIds: crew.members
      .filter((member) => isCrewInstanceReady(byId.get(member.instanceId)))
      .map((member) => member.instanceId),
  };
}

export function getCrewUnavailableReason(
  crew: Crew,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): CrewUnavailableReason | null {
  const byId = new Map(entries.map((entry) => [entry.instanceId, entry]));
  const planner = byId.get(crew.planner.instanceId);
  if (!planner) {
    return "planner-instance-missing";
  }
  if (!isCrewInstanceReady(planner)) {
    return "planner-instance-unavailable";
  }
  if (!crew.members.some((member) => isCrewInstanceReady(byId.get(member.instanceId)))) {
    return "no-available-members";
  }
  return null;
}

export function sortCrews(
  crews: ReadonlyArray<Crew>,
  lastUsedAt: Readonly<Record<string, number>>,
): ReadonlyArray<Crew> {
  return crews.toSorted((left, right) => {
    const recentDelta = (lastUsedAt[right.id] ?? 0) - (lastUsedAt[left.id] ?? 0);
    return recentDelta || left.name.localeCompare(right.name);
  });
}

export function makeCrewId(name: string, existingIds: ReadonlySet<string>): CrewId {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  const base = /^[a-z]/u.test(normalized) ? normalized : `crew-${normalized || "new"}`;
  let candidate = base.slice(0, 64);
  let suffix = 2;
  while (existingIds.has(candidate)) {
    const ending = `-${suffix}`;
    candidate = `${base.slice(0, 64 - ending.length)}${ending}`;
    suffix += 1;
  }
  return CrewId.make(candidate);
}

/**
 * The starter crew: Fable plans at max effort, the other ready agents
 * execute. Used to prefill the editor on first run — never saved silently.
 * Returns null when no ready instance can take the planner seat.
 */
export function buildOrchestratorTemplate(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): Crew | null {
  const ready = entries.filter(isCrewInstanceReady);
  const byDriver = (kind: string) => ready.find((entry) => entry.driverKind === kind);
  const claude = byDriver("claudeAgent");
  const fable = claude?.models.find((model) => model.slug.includes("fable"));
  const planner = claude && fable ? { entry: claude, model: fable.slug } : null;
  const fallback = ready[0];
  const fallbackModel = fallback?.models.find((model) => model.isDefault) ?? fallback?.models[0];
  const seat =
    planner ?? (fallback && fallbackModel ? { entry: fallback, model: fallbackModel.slug } : null);
  if (!seat) return null;
  const effortId = seat.entry.models
    .find((model) => model.slug === seat.model)
    ?.capabilities?.optionDescriptors?.find((descriptor) => descriptor.type === "select")?.id;
  const memberSeats = [
    { kind: "codex", role: "build" },
    { kind: "claudeAgent", role: "review" },
    { kind: "kimi", role: "design" },
    { kind: "ollama", role: "local" },
  ]
    .map(({ kind, role }) => ({ entry: byDriver(kind), role }))
    .filter((candidate): candidate is { entry: ProviderInstanceEntry; role: string } =>
      Boolean(candidate.entry),
    );
  if (memberSeats.length === 0 && ready.length > 0) {
    memberSeats.push({ entry: ready[0]!, role: "build" });
  }
  if (memberSeats.length === 0) return null;
  return {
    id: CrewId.make("orchestrator"),
    name: "Orchestrator",
    planner: {
      instanceId: seat.entry.instanceId,
      model: seat.model,
      ...(planner && effortId ? { options: [{ id: effortId, value: "xhigh" }] } : {}),
    },
    members: memberSeats.map(({ entry, role }) => ({ instanceId: entry.instanceId, role })),
  };
}
