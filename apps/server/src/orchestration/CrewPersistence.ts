import type { Crew, OrchestrationCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";

export type CrewPersistenceCommand = Extract<
  OrchestrationCommand,
  { readonly type: "crew.create" | "crew.update" | "crew.delete" }
>;

export function isCrewPersistenceCommand(
  command: OrchestrationCommand,
): command is CrewPersistenceCommand {
  return (
    command.type === "crew.create" ||
    command.type === "crew.update" ||
    command.type === "crew.delete"
  );
}

function upsertCrew(crews: ReadonlyArray<Crew>, crew: Crew): ReadonlyArray<Crew> {
  const existingIndex = crews.findIndex((candidate) => candidate.id === crew.id);
  if (existingIndex === -1) {
    return [...crews, crew];
  }
  return crews.map((candidate, index) => (index === existingIndex ? crew : candidate));
}

/**
 * Project an accepted crew command into server settings.
 *
 * The operation is idempotent so a client can safely retry a command whose
 * event committed before the settings response reached the client.
 */
export const persistCrewCommand = Effect.fn("persistCrewCommand")(function* (
  command: CrewPersistenceCommand,
) {
  const serverSettings = yield* ServerSettingsService;
  const settings = yield* serverSettings.getSettings;
  const crews =
    command.type === "crew.delete"
      ? settings.crews.filter((crew) => crew.id !== command.crewId)
      : upsertCrew(settings.crews, command.crew);

  yield* serverSettings.updateSettings({ crews });
});
