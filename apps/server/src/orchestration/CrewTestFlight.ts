import type {
  CrewTestFlightTurnInput,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import { resolveCheapestChatModel } from "@t3tools/shared/model";

import type { CrewRegistryEntry } from "./Services/CrewRegistry.ts";

export interface CrewTestFlightPlan {
  readonly plannerModelSelection: ModelSelection;
  readonly turnInput: CrewTestFlightTurnInput;
  readonly prompt: string;
}

const seatRole = (role: string | undefined, instanceId: ProviderInstanceId): string =>
  role ?? String(instanceId);

export function buildCrewTestFlightPlan(
  entry: CrewRegistryEntry,
  providers: ReadonlyArray<ServerProvider>,
): CrewTestFlightPlan | undefined {
  const { crew, availableMemberIds } = entry.resolvedCrew;
  const providersById = new Map(providers.map((provider) => [provider.instanceId, provider]));
  const plannerProvider = providersById.get(crew.planner.instanceId);
  const plannerModel = plannerProvider ? resolveCheapestChatModel(plannerProvider) : undefined;
  if (!plannerModel) return undefined;

  const seatOverrides = crew.members.flatMap((member) => {
    const provider = providersById.get(member.instanceId);
    const model = provider ? resolveCheapestChatModel(provider) : undefined;
    return model ? [{ instanceId: member.instanceId, model }] : [];
  });
  const overridesById = new Map(
    seatOverrides.map((override) => [override.instanceId, override.model]),
  );
  const available = new Set(availableMemberIds);
  const manifest = crew.members.map((member) => {
    const role = seatRole(member.role, member.instanceId);
    const displayName = entry.memberDisplayNames.get(member.instanceId) ?? member.instanceId;
    return `- seat: ${displayName}; instanceId: ${member.instanceId}; role: ${role}; model: ${overridesById.get(member.instanceId) ?? "unavailable"}; availability: ${available.has(member.instanceId) ? "available" : "unavailable"}`;
  });

  return {
    plannerModelSelection: {
      instanceId: crew.planner.instanceId,
      model: plannerModel,
    },
    turnInput: { seatOverrides },
    prompt: `<crew_test_flight version="1">
Run a read-only test of every crew seat.

Seat manifest:
${manifest.join("\n")}

For EVERY available seat, call \`dispatch\` exactly once. Start all dispatches before awaiting any. Give each child this exact task: Reply with exactly "TEST COMPLETE — {role}" and nothing else. Replace {role} with that seat's role from the manifest.

Do not edit files. Do not run shell commands. Do not use any tool except \`dispatch\`, \`list_dispatches\`, and \`await_dispatch\`. Each child must also use no tools.

Await every accepted dispatch with \`timeoutSeconds\` set to 30. An unavailable seat must appear as \`declined\`; never omit it. Then report one Markdown table with these columns: Seat, Model, Status, Reply. Use the manifest model for each seat. Finish immediately after the table.
</crew_test_flight>`,
  };
}
