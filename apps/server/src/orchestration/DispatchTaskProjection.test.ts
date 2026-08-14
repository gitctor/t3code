import { expect, it } from "@effect/vitest";
import {
  DispatchId,
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { foldSubagentActivities } from "../../../../packages/client-runtime/src/state/subagentRuntime.ts";
import type { ProjectionDispatch } from "../persistence/Services/ProjectionDispatches.ts";
import { runtimeEventToActivities } from "./Layers/ProviderRuntimeIngestion.ts";
import { makeDispatchTaskRuntimeEvent } from "./DispatchTaskProjection.ts";

const decodeRuntimeEvent = Schema.decodeUnknownSync(ProviderRuntimeEvent);
const dispatchId = DispatchId.make("dispatch-projection-1");
const instanceId = ProviderInstanceId.make("claude-builder");
const childThreadId = ThreadId.make("child-thread-1");
const now = "2026-08-11T12:00:00.000Z";

const dispatch: ProjectionDispatch = {
  dispatchId,
  parentThreadId: ThreadId.make("parent-thread-1"),
  parentTurnId: TurnId.make("parent-turn-1"),
  childThreadId,
  instanceId,
  provider: ProviderDriverKind.make("claudeAgent"),
  model: "claude-opus-4-1",
  role: "build",
  title: "Implement dispatch persistence",
  effort: "high",
  status: "running",
  reason: null,
  summary: null,
  startedAt: now,
  settledAt: null,
};

const projections = [
  { kind: "started" as const },
  {
    kind: "progress" as const,
    summary: "Editing the dispatch projection",
    lastToolName: "apply_patch",
    status: "running" as const,
  },
  { kind: "updated" as const, status: "waiting" as const },
  {
    kind: "completed" as const,
    status: "completed" as const,
    summary: "Projection implemented",
  },
];

const projectLifecycle = (row: ProjectionDispatch, prefix: string) =>
  projections.map((projection, index) =>
    decodeRuntimeEvent(
      makeDispatchTaskRuntimeEvent({
        dispatch: row,
        eventId: EventId.make(`${prefix}-${index}`),
        createdAt: `2026-08-11T12:00:0${index}.000Z`,
        projection,
      }),
    ),
  );

it("decodes task lifecycle events and folds the projected row in the existing Agents model", () => {
  const events = projectLifecycle(dispatch, "dispatch-event");

  expect(events.map((event) => event.type)).toEqual([
    "task.started",
    "task.progress",
    "task.updated",
    "task.completed",
  ]);
  for (const event of events) {
    expect(event.payload).toMatchObject({
      taskId: dispatchId,
      title: dispatch.title,
      model: dispatch.model,
      role: dispatch.role,
      effort: dispatch.effort,
      instanceId,
      childThreadId,
    });
  }

  const activities = events.flatMap((event) => runtimeEventToActivities(event, dispatch.title));
  for (const activity of activities) {
    expect(activity.payload).toMatchObject({
      taskId: dispatchId,
      instanceId,
      childThreadId,
    });
  }

  const agents = foldSubagentActivities(activities);
  expect(agents).toHaveLength(1);
  expect(agents[0]).toMatchObject({
    id: dispatchId,
    title: dispatch.title,
    model: dispatch.model,
    role: dispatch.role,
    effort: dispatch.effort,
    status: "completed",
    result: "Projection implemented",
  });
});

it("projects a test-flight dispatch through the same task rows as a normal dispatch", () => {
  const testFlightDispatch: ProjectionDispatch = {
    ...dispatch,
    dispatchId: DispatchId.make("test-flight-dispatch"),
    model: "claude-haiku-4-5",
    title: "Test flight — build",
  };
  const normalEvents = projectLifecycle(dispatch, "normal-dispatch-event");
  const testFlightEvents = projectLifecycle(testFlightDispatch, "test-flight-event");

  expect(testFlightEvents.map((event) => event.type)).toEqual(
    normalEvents.map((event) => event.type),
  );
  const agents = foldSubagentActivities(
    testFlightEvents.flatMap((event) => runtimeEventToActivities(event, testFlightDispatch.title)),
  );
  expect(agents).toHaveLength(1);
  expect(agents[0]).toMatchObject({
    id: testFlightDispatch.dispatchId,
    title: testFlightDispatch.title,
    model: "claude-haiku-4-5",
    status: "completed",
  });
});
