import {
  EventId,
  RuntimeTaskId,
  type ProviderRuntimeEvent,
  type RuntimeTaskStatus,
} from "@t3tools/contracts";

import type { ProjectionDispatch } from "../persistence/Services/ProjectionDispatches.ts";

type DispatchTaskProjection =
  | { readonly kind: "started" }
  | {
      readonly kind: "progress";
      readonly summary: string;
      readonly lastToolName?: string;
      readonly status?: RuntimeTaskStatus;
      readonly error?: string;
    }
  | {
      readonly kind: "updated";
      readonly status: RuntimeTaskStatus;
      readonly error?: string;
    }
  | {
      readonly kind: "completed";
      readonly status: "completed" | "failed" | "stopped";
      readonly summary?: string;
    };

export function makeDispatchTaskRuntimeEvent(input: {
  readonly dispatch: ProjectionDispatch;
  readonly eventId: EventId;
  readonly createdAt: string;
  readonly projection: DispatchTaskProjection;
}): ProviderRuntimeEvent {
  const { dispatch, eventId, createdAt, projection } = input;
  const taskId = RuntimeTaskId.make(dispatch.dispatchId);
  const linkage = {
    taskType: "subagent",
    agentKind: "agent" as const,
    title: dispatch.title,
    ...(dispatch.role !== null ? { role: dispatch.role } : {}),
    ...(dispatch.model !== null ? { model: dispatch.model } : {}),
    ...(dispatch.effort !== null ? { effort: dispatch.effort } : {}),
    instanceId: dispatch.instanceId,
    ...(dispatch.childThreadId !== null ? { childThreadId: dispatch.childThreadId } : {}),
    timelineBypass: true,
  } as const;
  const base = {
    eventId,
    provider: dispatch.provider,
    providerInstanceId: dispatch.instanceId,
    threadId: dispatch.parentThreadId,
    turnId: dispatch.parentTurnId,
    createdAt,
  } as const;

  switch (projection.kind) {
    case "started":
      return {
        ...base,
        type: "task.started",
        payload: {
          taskId,
          description: dispatch.title,
          ...linkage,
        },
      };
    case "progress":
      return {
        ...base,
        type: "task.progress",
        payload: {
          taskId,
          description: dispatch.title,
          summary: projection.summary,
          ...(projection.lastToolName !== undefined
            ? { lastToolName: projection.lastToolName }
            : {}),
          ...(projection.status !== undefined ? { status: projection.status } : {}),
          ...(projection.error !== undefined ? { error: projection.error } : {}),
          ...linkage,
        },
      };
    case "updated":
      return {
        ...base,
        type: "task.updated",
        payload: {
          taskId,
          status: projection.status,
          description: dispatch.title,
          ...(projection.error !== undefined ? { error: projection.error } : {}),
          ...linkage,
        },
      };
    case "completed":
      return {
        ...base,
        type: "task.completed",
        payload: {
          taskId,
          status: projection.status,
          ...(projection.summary !== undefined ? { summary: projection.summary } : {}),
          ...linkage,
        },
      };
  }
}
