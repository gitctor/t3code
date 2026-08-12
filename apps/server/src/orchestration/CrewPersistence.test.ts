import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, CrewId, ProviderInstanceId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";
import { createEmptyReadModel } from "./projector.ts";
import { decideOrchestrationCommand } from "./decider.ts";
import { persistCrewCommand } from "./CrewPersistence.ts";

const createdAt = "2026-08-11T12:00:00.000Z";
const crewId = CrewId.make("deep_build");
const codex = ProviderInstanceId.make("codex");
const claude = ProviderInstanceId.make("claudeAgent");
const crew = {
  id: crewId,
  name: "Deep Build",
  planner: { instanceId: claude, model: "claude-opus-5" },
  members: [{ instanceId: codex, role: "build" }],
} as const;

it.layer(NodeServices.layer)("crew persistence", (it) => {
  it.effect("round-trips create, update, and delete through commands and events", () =>
    Effect.gen(function* () {
      const settings = yield* ServerSettingsService;
      const readModel = createEmptyReadModel(createdAt);
      const createCommand = {
        type: "crew.create" as const,
        commandId: CommandId.make("crew-create"),
        crew,
        createdAt,
      };

      const created = yield* decideOrchestrationCommand({ command: createCommand, readModel });
      if (!("type" in created)) return assert.fail("expected one crew.created event");
      assert.equal(created.type, "crew.created");
      yield* persistCrewCommand(createCommand);
      assert.deepEqual((yield* settings.getSettings).crews, [crew]);

      const updatedCrew = { ...crew, name: "Deep Review" };
      const updateCommand = {
        type: "crew.update" as const,
        commandId: CommandId.make("crew-update"),
        crew: updatedCrew,
        createdAt,
      };
      const updated = yield* decideOrchestrationCommand({ command: updateCommand, readModel });
      if (!("type" in updated)) return assert.fail("expected one crew.updated event");
      assert.equal(updated.type, "crew.updated");
      yield* persistCrewCommand(updateCommand);
      assert.deepEqual((yield* settings.getSettings).crews, [updatedCrew]);

      const deleteCommand = {
        type: "crew.delete" as const,
        commandId: CommandId.make("crew-delete"),
        crewId,
        createdAt,
      };
      const deleted = yield* decideOrchestrationCommand({ command: deleteCommand, readModel });
      if (!("type" in deleted)) return assert.fail("expected one crew.deleted event");
      assert.equal(deleted.type, "crew.deleted");
      yield* persistCrewCommand(deleteCommand);
      assert.deepEqual((yield* settings.getSettings).crews, []);
    }).pipe(Effect.provide(ServerSettingsService.layerTest())),
  );
});
