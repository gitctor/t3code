import { CrewId, type Crew, type CrewUnavailableReason } from "@t3tools/contracts";

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
