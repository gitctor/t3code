import {
  ListMessageableThreadsInput,
  ListMessageableThreadsResult,
  SendToThreadInput,
  SendToThreadResult,
  ThreadMessagingError,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadMessagingBroker from "../../ThreadMessagingBroker.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadMessagingBroker.ThreadMessagingBroker,
];

export const ListThreadsTool = Tool.make("list_threads", {
  description:
    "List only the threads this active turn may message under the operator's current messaging scope.",
  parameters: ListMessageableThreadsInput,
  success: ListMessageableThreadsResult,
  failure: ThreadMessagingError,
  dependencies,
})
  .annotate(Tool.Title, "List messageable threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const SendToThreadTool = Tool.make("send_to_thread", {
  description:
    "Send a message to another allowed thread. T3 Code adds a trusted source envelope, steers a compatible running target, or queues one FIFO delivery for its next turn.",
  parameters: SendToThreadInput,
  success: SendToThreadResult,
  failure: ThreadMessagingError,
  dependencies,
})
  .annotate(Tool.Title, "Send to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const MessagingToolkit = Toolkit.make(ListThreadsTool, SendToThreadTool);
