import type { OrchestrationEvent, ThreadMessage } from "@t3tools/contracts";

import type { ProjectionCrossThreadMessage } from "../persistence/Services/ProjectionCrossThreadMessages.ts";

export type CrossThreadMessageLifecycleEvent = Extract<
  OrchestrationEvent,
  { readonly type: "message.sent" | "message.delivered" | "message.rejected" }
>;

export function crossThreadMessageProjectionRow(
  event: CrossThreadMessageLifecycleEvent,
): ProjectionCrossThreadMessage {
  const message = event.payload.message;
  return {
    messageId: message.messageId,
    environmentId: message.environmentId,
    sourceThreadId: message.sourceThreadId,
    sourceTurnId: message.sourceTurnId,
    targetThreadId: message.targetThreadId,
    body: message.body,
    status: message.status,
    reason: message.reason ?? null,
    createdAt: message.createdAt,
    deliveredAt: message.deliveredAt ?? null,
  };
}

export function crossThreadMessageFromProjection(row: ProjectionCrossThreadMessage): ThreadMessage {
  return {
    messageId: row.messageId,
    environmentId: row.environmentId,
    sourceThreadId: row.sourceThreadId,
    sourceTurnId: row.sourceTurnId,
    targetThreadId: row.targetThreadId,
    body: row.body,
    status: row.status,
    ...(row.reason !== null ? { reason: row.reason } : {}),
    createdAt: row.createdAt,
    ...(row.deliveredAt !== null ? { deliveredAt: row.deliveredAt } : {}),
  };
}
