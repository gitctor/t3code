import {
  AwaitDispatchInput,
  DispatchAccepted,
  DispatchInput,
  DispatchListing,
  DispatchOutcome,
  OrchestrationError,
} from "@t3tools/contracts";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as DispatchBroker from "../../DispatchBroker.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, DispatchBroker.DispatchBroker];

export const DispatchTool = Tool.make("dispatch", {
  description:
    "Hand one task to a crew member. The call returns as soon as the child thread is accepted; use await_dispatch to collect its result.",
  parameters: DispatchInput,
  success: DispatchAccepted,
  failure: OrchestrationError,
  dependencies,
})
  .annotate(Tool.Title, "Dispatch crew work")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false);

export const AwaitDispatchTool = Tool.make("await_dispatch", {
  description:
    "Wait for one dispatched task to settle. A timeout reports running status instead of failing; call again until it settles.",
  parameters: AwaitDispatchInput,
  success: DispatchOutcome,
  failure: OrchestrationError,
  dependencies,
})
  .annotate(Tool.Title, "Await dispatched work")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const ListDispatchesTool = Tool.make("list_dispatches", {
  description: "List every task dispatched during this planner turn and its current status.",
  success: DispatchListing,
  failure: OrchestrationError,
  dependencies,
})
  .annotate(Tool.Title, "List dispatched work")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true);

export const OrchestrationToolkit = Toolkit.make(
  DispatchTool,
  AwaitDispatchTool,
  ListDispatchesTool,
);
