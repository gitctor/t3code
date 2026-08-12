import {
  type Crew,
  type CrewId,
  type EnvironmentId,
  type ModelSelection,
  type ProviderOptionSelection,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { getProviderOptionCurrentLabel, getProviderOptionDescriptors } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { OrbitIcon, PencilIcon, PlusIcon, StarIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useAtomSet } from "@effect/atom-react";

import {
  CREW_UNAVAILABLE_COPY,
  buildOrchestratorTemplate,
  getCrewUnavailableReason,
  sortCrews,
} from "../../crewSelection";
import { crewEditorRequestAtom } from "../../state/crewEditor";
import { useClientSettings, useUpdateClientSettings } from "../../hooks/useSettings";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";

function plannerEffort(
  entry: ProviderInstanceEntry | undefined,
  model: string,
  selections: ReadonlyArray<ProviderOptionSelection> | undefined,
): string | null {
  const capabilities = entry?.models.find((candidate) => candidate.slug === model)?.capabilities;
  if (!capabilities) return null;
  const descriptor = getProviderOptionDescriptors({ caps: capabilities, selections }).find(
    (candidate) => candidate.type === "select",
  );
  return getProviderOptionCurrentLabel(descriptor) ?? null;
}

function seatTooltip(crew: Crew, entries: ReadonlyMap<string, ProviderInstanceEntry>): string {
  const planner = entries.get(crew.planner.instanceId);
  const seats = [
    `Planner: ${planner?.displayName ?? crew.planner.instanceId} · ${crew.planner.model}`,
    ...crew.members.map((member) => {
      const entry = entries.get(member.instanceId);
      const model = member.model ? ` · ${member.model}` : " · Default model";
      const role = member.role ? ` · ${member.role}` : "";
      return `${entry?.displayName ?? member.instanceId}${model}${role}`;
    }),
  ];
  return seats.join("\n");
}

export function CrewPickerPane(props: {
  readonly environmentId: EnvironmentId;
  readonly crews: ReadonlyArray<Crew>;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly currentSelection: ModelSelection;
  readonly activeCrewId: CrewId | null;
  readonly onSelectCrew: (crew: Crew) => void;
  readonly onRequestClose?: () => void;
  readonly favoriteOnly?: boolean;
  readonly jumpOffset?: number;
  readonly keybindings?: ResolvedKeybindingsConfig;
  readonly terminalOpen?: boolean;
}) {
  const navigate = useNavigate();
  const favoriteCrewIds = useClientSettings((settings) => settings.favoriteCrewIds ?? []);
  const favoriteCrewIdSet = useMemo(() => new Set(favoriteCrewIds), [favoriteCrewIds]);
  const crewLastUsedAt = useClientSettings((settings) => settings.crewLastUsedAt ?? {});
  const updateSettings = useUpdateClientSettings();
  const setCrewEditorRequest = useAtomSet(crewEditorRequestAtom);
  // Editing closes the picker; the dialog itself is hosted by the composer so
  // it outlives this popover (see state/crewEditor.ts).
  const openEditor = (crew: Crew | null, template?: Crew) => {
    props.onRequestClose?.();
    setCrewEditorRequest({ crew, ...(template ? { template } : {}) });
  };
  const entriesById = useMemo(
    () => new Map(props.instanceEntries.map((entry) => [entry.instanceId, entry])),
    [props.instanceEntries],
  );
  const crews = useMemo(
    () =>
      sortCrews(props.crews, crewLastUsedAt).filter(
        (crew) => !props.favoriteOnly || favoriteCrewIdSet.has(crew.id),
      ),
    [crewLastUsedAt, favoriteCrewIdSet, props.crews, props.favoriteOnly],
  );
  const crewJumpMaps = useMemo(() => {
    const byIndex = new Map<number, Crew>();
    const byCrewId = new Map<CrewId, number>();
    let index = props.jumpOffset ?? 0;
    for (const crew of crews) {
      if (getCrewUnavailableReason(crew, props.instanceEntries)) continue;
      if (!modelPickerJumpCommandForIndex(index)) break;
      byIndex.set(index, crew);
      byCrewId.set(crew.id, index);
      index += 1;
    }
    return { byIndex, byCrewId };
  }, [crews, props.instanceEntries, props.jumpOffset]);

  useEffect(() => {
    if (!props.keybindings) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const command = resolveShortcutCommand(event, props.keybindings!, {
        platform: navigator.platform,
        context: {
          terminalFocus: false,
          terminalOpen: props.terminalOpen ?? false,
          modelPickerOpen: true,
        },
      });
      const index = modelPickerJumpIndexFromCommand(command ?? "");
      const crew = index === null ? null : crewJumpMaps.byIndex.get(index);
      if (!crew) return;
      event.preventDefault();
      event.stopPropagation();
      props.onSelectCrew(crew);
      props.onRequestClose?.();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    crewJumpMaps,
    props.keybindings,
    props.onRequestClose,
    props.onSelectCrew,
    props.terminalOpen,
  ]);

  const openSettings = () => {
    props.onRequestClose?.();
    void navigate({
      to: "/settings/providers",
      hash: "crews",
      hashScrollIntoView: false,
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {!props.favoriteOnly && crews.length > 0 ? (
        <div className="border-b px-4 py-3">
          <div className="text-sm font-semibold">Crews</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            A crew is one model that plans and hands work to your other agents.
          </div>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {crews.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
            <div>
              <div className="font-semibold">Crews</div>
              <p className="mt-1 text-sm text-muted-foreground">
                A crew is one model that plans and hands work to your other agents.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() =>
                openEditor(null, buildOrchestratorTemplate(props.instanceEntries) ?? undefined)
              }
            >
              <PlusIcon /> Create your Orchestrator crew
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {crews.map((crew) => {
              const reason = getCrewUnavailableReason(crew, props.instanceEntries);
              const plannerEntry = entriesById.get(crew.planner.instanceId);
              const plannerModel =
                plannerEntry?.models.find((model) => model.slug === crew.planner.model)?.name ??
                crew.planner.model;
              const effort = plannerEffort(plannerEntry, crew.planner.model, crew.planner.options);
              const isFavorite = favoriteCrewIdSet.has(crew.id);
              const crewIndex = crewJumpMaps.byCrewId.get(crew.id);
              const jumpCommand =
                crewIndex === undefined ? null : modelPickerJumpCommandForIndex(crewIndex);
              const jumpLabel =
                jumpCommand && props.keybindings
                  ? shortcutLabelForCommand(props.keybindings, jumpCommand, {
                      platform: navigator.platform,
                      context: {
                        terminalFocus: false,
                        terminalOpen: props.terminalOpen ?? false,
                        modelPickerOpen: true,
                      },
                    })
                  : null;
              return (
                <Tooltip key={crew.id}>
                  <TooltipTrigger
                    render={
                      <div
                        className={cn(
                          "group relative flex min-h-17 w-full items-start rounded-md px-3 py-2 text-left transition-colors hover:bg-accent",
                          props.activeCrewId === crew.id && "bg-accent",
                          reason && "text-muted-foreground opacity-65",
                        )}
                      />
                    }
                  >
                    <button
                      type="button"
                      // pr-20 clears the absolutely-positioned trailing cluster (jump key +
                      // edit + favorite ≈ 80px) on all three row lines, not just the name.
                      className="min-w-0 flex-1 pr-20 text-left"
                      onClick={() => {
                        if (reason) {
                          openEditor(crew);
                          return;
                        }
                        props.onSelectCrew(crew);
                        props.onRequestClose?.();
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <OrbitIcon className="size-3.5 shrink-0 opacity-80" />
                        <span className="truncate">{crew.name}</span>
                      </span>
                      <span
                        className="flex min-w-0 items-center gap-1 text-xs"
                        style={
                          plannerEntry?.accentColor
                            ? { color: plannerEntry.accentColor }
                            : undefined
                        }
                      >
                        {plannerEntry ? (
                          <ProviderInstanceIcon
                            driverKind={plannerEntry.driverKind}
                            displayName={plannerEntry.displayName}
                            className="size-3 shrink-0"
                            iconClassName="size-3"
                            badgeContent="none"
                          />
                        ) : null}
                        <span className="truncate">
                          {plannerModel}
                          {effort ? ` ${effort.toLowerCase()}` : ""} plans
                        </span>
                      </span>
                      <span className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
                        {reason ? (
                          CREW_UNAVAILABLE_COPY[reason]
                        ) : (
                          <>
                            <span className="shrink-0">→</span>
                            {crew.members.map((member, memberIndex) => {
                              const entry = entriesById.get(member.instanceId);
                              return (
                                <span
                                  key={`${member.instanceId}-${memberIndex}`}
                                  className="flex min-w-0 shrink items-center gap-1"
                                >
                                  {memberIndex > 0 ? <span className="shrink-0">·</span> : null}
                                  {entry ? (
                                    <ProviderInstanceIcon
                                      driverKind={entry.driverKind}
                                      displayName={entry.displayName}
                                      className="size-3 shrink-0"
                                      iconClassName="size-3"
                                      badgeContent="none"
                                    />
                                  ) : null}
                                  <span className="truncate">
                                    {entry?.displayName ?? member.instanceId}
                                    {member.role ? ` (${member.role})` : ""}
                                  </span>
                                </span>
                              );
                            })}
                          </>
                        )}
                      </span>
                    </button>
                    <div className="absolute right-2 top-1.5 flex items-center gap-0.5">
                      {jumpLabel ? (
                        <span className="px-1 font-mono text-[.65rem] text-muted-foreground">
                          {jumpLabel}
                        </span>
                      ) : null}
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                        aria-label={`Edit ${crew.name}`}
                        onClick={() => openEditor(crew)}
                      >
                        <PencilIcon />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`${isFavorite ? "Remove" : "Add"} ${crew.name} ${isFavorite ? "from" : "to"} favorites`}
                        onClick={() =>
                          updateSettings({
                            favoriteCrewIds: isFavorite
                              ? favoriteCrewIds.filter((id) => id !== crew.id)
                              : [...favoriteCrewIds, crew.id],
                          })
                        }
                      >
                        <StarIcon className={cn(isFavorite && "fill-current text-warning")} />
                      </Button>
                    </div>
                  </TooltipTrigger>
                  <TooltipPopup side="left" className="max-w-72 whitespace-pre-line">
                    {seatTooltip(crew, entriesById)}
                  </TooltipPopup>
                </Tooltip>
              );
            })}
            {!props.favoriteOnly ? (
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
                onClick={() => openEditor(null)}
              >
                <PlusIcon className="size-4" /> New crew…
              </button>
            ) : null}
            {!props.favoriteOnly ? (
              <button
                type="button"
                className="flex w-full items-center rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={openSettings}
              >
                Manage crews…
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
