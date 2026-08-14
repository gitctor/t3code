import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { isRunnableCrew, type Crew, type EnvironmentId, type ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { VariantProps } from "class-variance-authority";
import { FlaskConicalIcon } from "lucide-react";
import { useState } from "react";

import { resolveCrewForEntries } from "../../crewSelection";
import { orchestrationEnvironment } from "../../state/orchestration";
import { buildThreadRouteParams } from "../../threadRoutes";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, buttonVariants } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const TEST_FLIGHT_TOOLTIP = "Test flight — cheapest models, ~1 message each";

export function CrewTestFlightButton(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly crew: Crew;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly showLabel?: boolean;
  readonly variant?: VariantProps<typeof buttonVariants>["variant"];
  readonly onStarted?: () => void;
}) {
  const navigate = useNavigate();
  const [isStarting, setIsStarting] = useState(false);
  const startTestFlight = useAtomCommand(orchestrationEnvironment.startCrewTestFlight, {
    reportFailure: false,
  });
  const resolvedCrew = resolveCrewForEntries(props.crew, props.instanceEntries);
  const projectId = props.projectId;
  if (!projectId || !isRunnableCrew(resolvedCrew)) return null;

  const start = async () => {
    setIsStarting(true);
    const result = await startTestFlight({
      environmentId: props.environmentId,
      input: { crewId: props.crew.id, projectId },
    });
    setIsStarting(false);
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not start test flight",
          description: error instanceof Error ? error.message : "The crew test flight failed.",
        }),
      );
      return;
    }
    props.onStarted?.();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(props.environmentId, result.value.threadId)),
    });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size={props.showLabel ? "sm" : "icon-xs"}
            variant={props.variant ?? "ghost"}
            aria-label={`Test flight ${props.crew.name}`}
            disabled={isStarting}
            onClick={() => void start()}
          />
        }
      >
        <FlaskConicalIcon />
        {props.showLabel ? "Test flight" : null}
      </TooltipTrigger>
      <TooltipPopup>{TEST_FLIGHT_TOOLTIP}</TooltipPopup>
    </Tooltip>
  );
}
