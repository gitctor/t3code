import { RefreshCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";

import { Button } from "./ui/button";

export function PageRefreshButton(props: {
  readonly label: string;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      className="ml-auto [-webkit-app-region:no-drag]"
      aria-label={props.label}
      disabled={props.refreshing}
      onClick={props.onRefresh}
    >
      <RefreshCwIcon aria-hidden className={cn("size-4", props.refreshing && "animate-spin")} />
    </Button>
  );
}
