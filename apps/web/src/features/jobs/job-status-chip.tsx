import { Badge } from "../../components/ui/badge.js";
import { cn } from "../../lib/cn.js";
import { statusVariant } from "./format.js";

/**
 * A job's status as a chip, in the one colour code every job surface shares (`statusVariant`):
 * queued amber, running the accent tint with a pulsing dot, done green, failed red, cancelled
 * neutral. The dot is the only motion on the page, so "in flight" can be found without reading.
 */
export function JobStatusChip({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={statusVariant(status)} className={cn("shrink-0 gap-1.5", className)}>
      {status === "running" ? (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent-foreground motion-safe:animate-pulse" />
      ) : null}
      {status}
    </Badge>
  );
}
