import type { ProviderInstanceId } from "@t3tools/contracts";

import type { CrewRegistryEntry } from "./Services/CrewRegistry.ts";

const detail = (value: string | undefined, fallback: string): string => value ?? fallback;

export function buildCrewBriefing(entry: CrewRegistryEntry): string {
  const { crew, availableMemberIds } = entry.resolvedCrew;
  const available = new Set<ProviderInstanceId>(availableMemberIds);
  const roster = crew.members.map((member) => {
    const displayName = entry.memberDisplayNames.get(member.instanceId) ?? member.instanceId;
    return `- instanceId: ${member.instanceId}; display name: ${displayName}; model: ${detail(member.model, "instance default")}; role: ${detail(member.role, "not set")}; availability: ${available.has(member.instanceId) ? "available" : "unavailable"}`;
  });

  return `<crew_briefing version="1">
Crew: ${crew.name} (${crew.id})

Roster:
${roster.join("\n")}

Use \`dispatch\` to hand work to a crew member. Parallelize independent work. Chain dependent work with \`fromDispatchId\`. Use \`list_dispatches\` to check progress. Collect results with \`await_dispatch\`. Set \`timeoutSeconds\` to 300 or less, and call it again while work is running.

You are the planner. Hand implementation to the crew; do not do a member's work yourself unless every relevant member declined.
</crew_briefing>`;
}
