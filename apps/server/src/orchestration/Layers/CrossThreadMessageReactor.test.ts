import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { ProjectionCrossThreadMessageRepository } from "../../persistence/Services/ProjectionCrossThreadMessages.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { ProviderInstanceRegistry } from "../../provider/Services/ProviderInstanceRegistry.ts";
import { CrossThreadMessageReactor } from "../Services/CrossThreadMessageReactor.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { CrossThreadMessageReactorLive } from "./CrossThreadMessageReactor.ts";
import { CrossThreadMessageDeliveryLockLive } from "../../mcp/CrossThreadMessageDeliveryLock.ts";

const environmentId = EnvironmentId.make("environment-1");
const sourceThreadId = ThreadId.make("thread-source");
const targetThreadId = ThreadId.make("thread-target");
const sourceTurnId = TurnId.make("turn-source");
const instanceId = ProviderInstanceId.make("codex-main");
const createdAt = "2026-08-12T12:00:00.000Z";

const queued = {
  messageId: MessageId.make("message-queued"),
  environmentId,
  sourceThreadId,
  sourceTurnId,
  targetThreadId,
  body: "Deliver me after the target settles.",
  status: "queued" as const,
  reason: null,
  createdAt,
  deliveredAt: null,
};

const snapshot = (id: ThreadId, title: string) => ({
  id,
  projectId: "project-1",
  title,
  modelSelection: { instanceId, model: "gpt-5.6-sol" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "build/crew-suite",
  worktreePath: "/repo",
  latestTurn: null,
  createdAt,
  updatedAt: createdAt,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  messages: [],
  proposedPlans: [],
  activities: [],
  checkpoints: [],
  session: null,
});

it.effect("delivers the FIFO head from the durable queue on reactor startup", () => {
  const commands: OrchestrationCommand[] = [];
  const snapshots = new Map([
    [sourceThreadId, snapshot(sourceThreadId, "Source thread")],
    [targetThreadId, snapshot(targetThreadId, "Target thread")],
  ]);
  const layer = CrossThreadMessageReactorLive.pipe(
    Layer.provideMerge(
      Layer.mock(OrchestrationEngineService)({
        streamDomainEvents: Stream.empty,
        dispatch: (command) =>
          Effect.sync(() => {
            commands.push(command);
            return { sequence: commands.length };
          }),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProjectionCrossThreadMessageRepository)({
        listQueued: Effect.succeed([queued]),
        listQueuedByTarget: () => Effect.succeed([queued]),
        getById: () => Effect.succeed(Option.some(queued)),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProjectionSnapshotQuery)({
        getThreadDetailById: (threadId) =>
          Effect.succeed(Option.fromNullishOr(snapshots.get(threadId) as never)),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProjectionTurnRepository)({
        getPendingTurnStartByThreadId: () => Effect.succeed(Option.none()),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ProviderInstanceRegistry)({
        getInstance: () =>
          Effect.succeed({ driverKind: ProviderDriverKind.make("codex") } as never),
      }),
    ),
    Layer.provideMerge(
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(CrossThreadMessageDeliveryLockLive),
  );
  return Effect.scoped(
    Effect.gen(function* () {
      const reactor = yield* CrossThreadMessageReactor;
      yield* reactor.start();

      expect(commands.map((command) => command.type)).toEqual([
        "thread.turn.start",
        "thread.message.system.append",
        "thread.activity.append",
        "message.deliver",
      ]);
      expect(commands[0]).toMatchObject({
        type: "thread.turn.start",
        threadId: targetThreadId,
        message: {
          text: `[Message from thread Source thread (${sourceThreadId})]:\n${queued.body}`,
        },
      });
    }),
  ).pipe(Effect.provide(layer));
});
