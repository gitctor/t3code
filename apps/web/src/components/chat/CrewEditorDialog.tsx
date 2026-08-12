import {
  type Crew,
  type CrewMember,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { getProviderOptionCurrentValue, getProviderOptionDescriptors } from "@t3tools/shared/model";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  CREW_UNAVAILABLE_COPY,
  getCrewUnavailableReason,
  isCrewInstanceReady,
  makeCrewId,
} from "../../crewSelection";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { newCommandId, randomUUID } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";

type DraftMember = {
  readonly key: string;
  readonly instanceId: ProviderInstanceId | null;
  readonly model: string;
  readonly role: string;
};

function memberDraft(member: CrewMember, key: string): DraftMember {
  return {
    key,
    instanceId: member.instanceId,
    model: member.model ?? "",
    role: member.role ?? "",
  };
}

function selectModel(entry: ProviderInstanceEntry | undefined, requested: string): string {
  if (!entry) return "";
  if (requested && entry.models.some((model) => model.slug === requested)) return requested;
  return entry.models.find((model) => model.isDefault)?.slug ?? entry.models[0]?.slug ?? "";
}

export function CrewEditorDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly crews: ReadonlyArray<Crew>;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly currentSelection?: ModelSelection | null;
  readonly initialCrew?: Crew | null;
  readonly allowDelete?: boolean;
  readonly brokenReason?: ReturnType<typeof getCrewUnavailableReason>;
}) {
  const readyEntries = useMemo(
    () => props.instanceEntries.filter(isCrewInstanceReady),
    [props.instanceEntries],
  );
  const initialPlannerEntry =
    props.instanceEntries.find(
      (entry) =>
        entry.instanceId ===
        (props.initialCrew?.planner.instanceId ?? props.currentSelection?.instanceId),
    ) ?? readyEntries[0];
  const initialPlannerModel = selectModel(
    initialPlannerEntry,
    props.initialCrew?.planner.model ?? props.currentSelection?.model ?? "",
  );
  const [name, setName] = useState(props.initialCrew?.name ?? "");
  const [plannerInstanceId, setPlannerInstanceId] = useState<ProviderInstanceId | null>(
    initialPlannerEntry?.instanceId ?? null,
  );
  const [plannerModel, setPlannerModel] = useState(initialPlannerModel);
  const [plannerOptions, setPlannerOptions] = useState(
    props.initialCrew?.planner.options ?? props.currentSelection?.options,
  );
  const [members, setMembers] = useState<ReadonlyArray<DraftMember>>(() =>
    props.initialCrew?.members.length
      ? props.initialCrew.members.map((member, index) => memberDraft(member, `${index}`))
      : [
          {
            key: "new-member",
            instanceId: readyEntries[0]?.instanceId ?? null,
            model: "",
            role: "",
          },
        ],
  );
  const [submitted, setSubmitted] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const plannerTriggerRef = useRef<HTMLButtonElement>(null);
  const firstMemberTriggerRef = useRef<HTMLButtonElement>(null);
  const dispatchCommand = useAtomCommand(orchestrationEnvironment.dispatchCommand, {
    reportFailure: false,
  });

  useEffect(() => {
    const target =
      props.brokenReason === "no-available-members"
        ? firstMemberTriggerRef.current
        : props.brokenReason
          ? plannerTriggerRef.current
          : null;
    target?.scrollIntoView({ block: "nearest" });
    target?.focus();
  }, [props.brokenReason]);

  const plannerEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === plannerInstanceId,
  );
  const plannerCapabilities = plannerEntry?.models.find((model) => model.slug === plannerModel)
    ?.capabilities ?? { optionDescriptors: [] };
  const plannerDescriptors = getProviderOptionDescriptors({
    caps: plannerCapabilities,
    selections: plannerOptions,
  });
  const effortDescriptor = plannerDescriptors.find(
    (descriptor): descriptor is Extract<(typeof plannerDescriptors)[number], { type: "select" }> =>
      descriptor.type === "select",
  );
  const effortValue = getProviderOptionCurrentValue(effortDescriptor);
  const plannerMissing = plannerInstanceId === null || plannerModel.length === 0;
  const membersMissing = members.every((member) => !member.instanceId);
  const nameMissing = name.trim().length === 0;

  const updatePlannerInstance = (instanceId: ProviderInstanceId) => {
    const nextEntry = props.instanceEntries.find((entry) => entry.instanceId === instanceId);
    setPlannerInstanceId(instanceId);
    setPlannerModel(selectModel(nextEntry, ""));
    setPlannerOptions(undefined);
  };

  const save = async () => {
    setSubmitted(true);
    if (nameMissing || plannerMissing || membersMissing || !plannerInstanceId) return;
    const crew: Crew = {
      id:
        props.initialCrew?.id ??
        makeCrewId(name, new Set(props.crews.map((candidate) => candidate.id))),
      name: name.trim(),
      planner: {
        instanceId: plannerInstanceId,
        model: plannerModel,
        ...(plannerOptions?.length ? { options: plannerOptions } : {}),
      },
      members: members.flatMap((member) =>
        member.instanceId
          ? [
              {
                instanceId: member.instanceId,
                ...(member.model ? { model: member.model } : {}),
                ...(member.role.trim() ? { role: member.role.trim() } : {}),
              },
            ]
          : [],
      ),
    };
    if (crew.members.length === 0) return;
    setIsSaving(true);
    const result = await dispatchCommand({
      environmentId: props.environmentId,
      input: {
        type: props.initialCrew ? "crew.update" : "crew.create",
        commandId: newCommandId(),
        crew,
        createdAt: new Date().toISOString(),
      },
    });
    setIsSaving(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not ${props.initialCrew ? "update" : "create"} crew`,
          description: error instanceof Error ? error.message : "The crew command failed.",
        }),
      );
      return;
    }
    props.onOpenChange(false);
  };

  const deleteCrew = async () => {
    if (!props.initialCrew) return;
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete ${props.initialCrew.name}?\nThis removes the saved crew. Existing threads stay available.`,
      { variant: "destructive" },
    );
    if (!confirmed) return;
    setIsSaving(true);
    const result = await dispatchCommand({
      environmentId: props.environmentId,
      input: {
        type: "crew.delete",
        commandId: newCommandId(),
        crewId: props.initialCrew.id,
        createdAt: new Date().toISOString(),
      },
    });
    setIsSaving(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not delete crew",
        description: error instanceof Error ? error.message : "The crew command failed.",
      });
      return;
    }
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="w-full sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {props.initialCrew ? `Edit ${props.initialCrew.name}` : "New crew"}
          </DialogTitle>
          <DialogDescription>
            Pick one model to plan, then give it agents it can hand work to.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-5">
          {props.brokenReason ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning-foreground">
              {CREW_UNAVAILABLE_COPY[props.brokenReason]}
            </div>
          ) : null}

          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <Input
              autoFocus={!props.brokenReason}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              aria-invalid={submitted && nameMissing}
            />
            {submitted && nameMissing ? (
              <span className="text-xs text-destructive">Name is required.</span>
            ) : null}
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Planner</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              <Select
                value={plannerInstanceId}
                onValueChange={(value) => {
                  if (value) updatePlannerInstance(value);
                }}
              >
                <SelectTrigger ref={plannerTriggerRef} aria-label="Planner instance">
                  <SelectValue placeholder="Pick an instance" />
                </SelectTrigger>
                <SelectPopup>
                  {readyEntries.map((entry) => (
                    <SelectItem key={entry.instanceId} value={entry.instanceId}>
                      {entry.displayName}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={plannerModel}
                onValueChange={(model) => {
                  if (!model) return;
                  setPlannerModel(model);
                  setPlannerOptions(undefined);
                }}
              >
                <SelectTrigger aria-label="Planner model">
                  <SelectValue placeholder="Pick a model" />
                </SelectTrigger>
                <SelectPopup>
                  {plannerEntry?.models.map((model) => (
                    <SelectItem key={model.slug} value={model.slug}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Select
                value={typeof effortValue === "string" ? effortValue : null}
                disabled={!effortDescriptor}
                onValueChange={(value) => {
                  if (!effortDescriptor || !value) return;
                  setPlannerOptions([
                    ...(plannerOptions ?? []).filter(
                      (selection) => selection.id !== effortDescriptor.id,
                    ),
                    { id: effortDescriptor.id, value },
                  ]);
                }}
              >
                <SelectTrigger aria-label="Planner effort">
                  <SelectValue placeholder="Effort" />
                </SelectTrigger>
                <SelectPopup>
                  {effortDescriptor?.options.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            {submitted && plannerMissing ? (
              <span className="text-xs text-destructive">Pick who plans.</span>
            ) : null}
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Crew members</legend>
            {members.map((member, index) => {
              const entry = props.instanceEntries.find(
                (candidate) => candidate.instanceId === member.instanceId,
              );
              return (
                <div
                  key={member.key}
                  className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_1fr_1fr_auto]"
                >
                  <Select
                    value={member.instanceId}
                    onValueChange={(instanceId) => {
                      if (!instanceId) return;
                      setMembers((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, instanceId, model: "" } : item,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger
                      ref={index === 0 ? firstMemberTriggerRef : undefined}
                      aria-label={`Crew member ${index + 1} instance`}
                    >
                      <SelectValue placeholder="Pick an instance" />
                    </SelectTrigger>
                    <SelectPopup>
                      {readyEntries.map((candidate) => (
                        <SelectItem key={candidate.instanceId} value={candidate.instanceId}>
                          {candidate.displayName}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Select
                    value={member.model || "__default__"}
                    onValueChange={(model) => {
                      if (!model) return;
                      setMembers((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, model: model === "__default__" ? "" : model }
                            : item,
                        ),
                      );
                    }}
                  >
                    <SelectTrigger aria-label={`Crew member ${index + 1} model`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__default__">Default model</SelectItem>
                      {entry?.models.map((model) => (
                        <SelectItem key={model.slug} value={model.slug}>
                          {model.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                  <Input
                    maxLength={32}
                    value={member.role}
                    placeholder="build, review, design…"
                    aria-label={`Crew member ${index + 1} role`}
                    onChange={(event) => {
                      const role = event.currentTarget.value;
                      setMembers((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, role } : item,
                        ),
                      );
                    }}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove crew member ${index + 1}`}
                    onClick={() =>
                      setMembers((current) => current.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              className="justify-start"
              onClick={() =>
                setMembers((current) => [
                  ...current,
                  {
                    key: randomUUID(),
                    instanceId: readyEntries[0]?.instanceId ?? null,
                    model: "",
                    role: "",
                  },
                ])
              }
            >
              <PlusIcon /> Add member
            </Button>
            {submitted && membersMissing ? (
              <span className="text-xs text-destructive">Add at least one crew member.</span>
            ) : null}
          </fieldset>
        </DialogPanel>
        <DialogFooter className="sm:justify-between">
          <div>
            {props.allowDelete && props.initialCrew ? (
              <Button
                type="button"
                variant="destructive"
                disabled={isSaving}
                onClick={() => void deleteCrew()}
              >
                Delete crew
              </Button>
            ) : null}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={isSaving} onClick={() => void save()}>
              Save crew
            </Button>
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
