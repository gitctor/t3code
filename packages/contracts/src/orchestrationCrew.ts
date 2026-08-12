/**
 * Cross-provider orchestration contracts.
 *
 * A **crew** is a saved answer to "who plans, and who may it hand work to".
 * It names one planner (a provider instance plus its model and options) and a
 * roster of instances the planner is allowed to dispatch to. Selecting a crew
 * in the model picker is the entire mode switch.
 *
 * A **dispatch** is one unit of handed-off work. The child it starts is an
 * ordinary thread on the target instance, linked back to the turn that asked
 * for it. Nothing here introduces a second runtime: dispatched children reuse
 * threads, worktrees, checkpointing, and the existing `task.*` provider-runtime
 * events, which is why the Agents panel renders them without a new schema.
 *
 * Forward/backward compatibility invariant
 * ----------------------------------------
 * Crews reference provider instances by id, and those ids can vanish — a fork
 * removed a driver, the user deleted an instance, a branch roll dropped one.
 * Decoding a crew that names a missing instance must always succeed; resolving
 * it to something runnable is the runtime's job, and it reports the crew as
 * degraded rather than failing to parse. Same rule as `providerInstance`.
 *
 * @module orchestrationCrew
 */
import * as Schema from "effect/Schema";
import { ForwardCompatibleArray, ThreadId, TrimmedNonEmptyString, TurnId } from "./baseSchemas.ts";
import { ProviderOptionSelection } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const CREW_SLUG_MAX_CHARS = 64;
const CREW_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const CREW_NAME_MAX_CHARS = 60;
const CREW_ROLE_MAX_CHARS = 32;

/**
 * `CrewId` — user-defined routing key for a saved crew. Same slug rules as
 * provider ids so crews can sit beside instances in the picker rail without a
 * second escaping story.
 */
export const CrewId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CREW_SLUG_MAX_CHARS),
  Schema.isPattern(CREW_SLUG_PATTERN),
).pipe(Schema.brand("CrewId"));
export type CrewId = typeof CrewId.Type;

/**
 * Short human label for what a member is for ("build", "review", "design").
 * Presentation only — it is passed to the planner as a hint and shown on the
 * agent row, and never used for routing.
 */
export const CrewMemberRole = TrimmedNonEmptyString.check(Schema.isMaxLength(CREW_ROLE_MAX_CHARS));
export type CrewMemberRole = typeof CrewMemberRole.Type;

/**
 * The planner seat. Unlike members, its model is required: a crew whose
 * planner has no model is not runnable, and we would rather say so at the
 * boundary than pick one silently.
 */
export const CrewPlanner = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
});
export type CrewPlanner = typeof CrewPlanner.Type;

/**
 * One dispatchable seat. `model` is optional — omitted means "whatever that
 * instance defaults to", which keeps a crew working after a provider renames
 * its models.
 */
export const CrewMember = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: Schema.optionalKey(TrimmedNonEmptyString),
  options: Schema.optionalKey(Schema.Array(ProviderOptionSelection)),
  role: Schema.optionalKey(CrewMemberRole),
});
export type CrewMember = typeof CrewMember.Type;

/**
 * A saved crew. Members use `ForwardCompatibleArray` so one member referencing
 * a driver this build cannot load does not discard the rest of the roster.
 */
export const Crew = Schema.Struct({
  id: CrewId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(CREW_NAME_MAX_CHARS)),
  planner: CrewPlanner,
  members: ForwardCompatibleArray(CrewMember),
});
export type Crew = typeof Crew.Type;

export const Crews = ForwardCompatibleArray(Crew);
export type Crews = typeof Crews.Type;

/**
 * `DispatchId` — identifies one handed-off unit of work for the life of the
 * parent turn. The planner receives this from `dispatch` and uses it to await
 * or inspect the child.
 */
export const DispatchId = TrimmedNonEmptyString.pipe(Schema.brand("DispatchId"));
export type DispatchId = typeof DispatchId.Type;

/**
 * Dispatch lifecycle.
 *
 * `queued` covers both "not started yet" and "waiting on a concurrency slot" —
 * the distinction is not actionable for the user, and the Agents panel already
 * collapses every in-flight state into one steady "Working" presentation.
 * `declined` is its own terminal state, separate from `failed`: the target
 * refused the work (unavailable instance, adapter cannot host a dispatched
 * turn) and nothing ran, so it needs a different remedy than a child that ran
 * and errored.
 */
export const DispatchStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "declined",
  "cancelled",
]);
export type DispatchStatus = typeof DispatchStatus.Type;

const SETTLED_DISPATCH_STATUSES = new Set<DispatchStatus>([
  "completed",
  "failed",
  "declined",
  "cancelled",
]);

/** Whether a dispatch has reached a terminal state and will not change again. */
export const isSettledDispatchStatus = (status: DispatchStatus): boolean =>
  SETTLED_DISPATCH_STATUSES.has(status);

/**
 * The parent-side record of a dispatch.
 *
 * `childThreadId` is absent until the child thread exists, which is also the
 * shape a `declined` dispatch keeps forever — it never got a thread. Consumers
 * must treat the link as optional rather than assuming a settled dispatch has
 * one.
 */
export const DispatchRecord = Schema.Struct({
  dispatchId: DispatchId,
  parentThreadId: ThreadId,
  parentTurnId: TurnId,
  childThreadId: Schema.optionalKey(ThreadId),
  instanceId: ProviderInstanceId,
  model: Schema.optionalKey(TrimmedNonEmptyString),
  role: Schema.optionalKey(CrewMemberRole),
  status: DispatchStatus,
  /** Why a dispatch is `declined` or `failed`. Absent otherwise. */
  reason: Schema.optionalKey(TrimmedNonEmptyString),
  startedAt: TrimmedNonEmptyString,
  settledAt: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DispatchRecord = typeof DispatchRecord.Type;

/**
 * Why a crew cannot run as saved. Reported per crew by the runtime so the
 * picker can show a crew as degraded instead of hiding it — a crew that
 * disappears because one provider is logged out is worse than one that says so.
 */
export const CrewUnavailableReason = Schema.Literals([
  "planner-instance-missing",
  "planner-instance-unavailable",
  "no-available-members",
]);
export type CrewUnavailableReason = typeof CrewUnavailableReason.Type;

/**
 * Runtime view of a saved crew: the crew as authored, plus which seats
 * currently resolve. `availableMemberIds` is a subset of the crew's members;
 * an empty set with a healthy planner still blocks the run, because a planner
 * with nobody to dispatch to is just a normal thread wearing a costume.
 */
export const ResolvedCrew = Schema.Struct({
  crew: Crew,
  plannerAvailable: Schema.Boolean,
  availableMemberIds: ForwardCompatibleArray(ProviderInstanceId),
  unavailableReason: Schema.optionalKey(CrewUnavailableReason),
});
export type ResolvedCrew = typeof ResolvedCrew.Type;

/** Whether a resolved crew can start a turn. */
export const isRunnableCrew = (resolved: ResolvedCrew): boolean =>
  resolved.plannerAvailable && resolved.availableMemberIds.length > 0;

/* -------------------------------------------------------------------------
 * Orchestrator MCP toolkit I/O
 *
 * These are the shapes the planner sees. They are deliberately small: the
 * planner picks a seat and writes a prompt, and everything else — worktree,
 * checkpointing, transcript, panel row — is T3's job, not something the model
 * should have to reason about.
 * ---------------------------------------------------------------------- */

const DISPATCH_PROMPT_MAX_CHARS = 100_000;

export const DispatchInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: Schema.optionalKey(TrimmedNonEmptyString),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(DISPATCH_PROMPT_MAX_CHARS)),
  role: Schema.optionalKey(CrewMemberRole),
  /**
   * Chain this dispatch onto an earlier one's output: the child's worktree
   * branches from that dispatch's child-thread branch instead of the parent's.
   * This is how build-then-review works — the reviewer sees the builder's
   * commits. The referenced dispatch must be settled `completed`; anything
   * else fails with `dispatch-not-found`.
   */
  fromDispatchId: Schema.optionalKey(DispatchId),
});
export type DispatchInput = typeof DispatchInput.Type;

/**
 * `dispatch` returns as soon as the child is accepted, not when it finishes.
 * A planner that wants to fan out three agents must not be blocked by the
 * first one.
 */
export const DispatchAccepted = Schema.Struct({
  dispatchId: DispatchId,
  instanceId: ProviderInstanceId,
  model: Schema.optionalKey(TrimmedNonEmptyString),
  status: DispatchStatus,
});
export type DispatchAccepted = typeof DispatchAccepted.Type;

export const AwaitDispatchInput = Schema.Struct({
  dispatchId: DispatchId,
  /** Give up waiting after this long and report `running`. Absent means wait. */
  timeoutSeconds: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3600 })),
  ),
});
export type AwaitDispatchInput = typeof AwaitDispatchInput.Type;

/**
 * What the planner reads back. `summary` is the child's final assistant
 * message; it is absent for any dispatch that produced no message (declined,
 * cancelled before first token).
 */
export const DispatchOutcome = Schema.Struct({
  dispatchId: DispatchId,
  status: DispatchStatus,
  summary: Schema.optionalKey(Schema.String),
  reason: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DispatchOutcome = typeof DispatchOutcome.Type;

export const DispatchListing = Schema.Struct({
  dispatches: ForwardCompatibleArray(DispatchRecord),
});
export type DispatchListing = typeof DispatchListing.Type;

/**
 * Why a tool call could not be served. Kept as a closed set so the planner can
 * branch on it rather than string-matching a message: `not-orchestrating` tells
 * it to stop trying, `instance-not-in-crew` tells it to pick another seat.
 */
export const OrchestrationErrorCode = Schema.Literals([
  "not-orchestrating",
  "instance-not-in-crew",
  "instance-unavailable",
  "dispatch-not-found",
  "dispatch-limit-reached",
]);
export type OrchestrationErrorCode = typeof OrchestrationErrorCode.Type;

export class OrchestrationError extends Schema.ErrorClass<OrchestrationError>("OrchestrationError")(
  {
    code: OrchestrationErrorCode,
    message: TrimmedNonEmptyString,
  },
) {}
