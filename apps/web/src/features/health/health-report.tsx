import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card.js";
import { useLiveHealth } from "./live.js";
import {
  configStatus,
  harnessDetail,
  harnessProblems,
  harnessStatus,
  indexStatus,
  lastHookStatus,
  type Status,
} from "./status.js";

/**
 * `workledger doctor` as a page: every harness, the index, the config, and when a hook last fired
 * (design spec §8 "Health"). Each row carries its own reading so a broken one is findable without
 * reading the prose.
 */
export function HealthReport() {
  const result = useLiveHealth();

  return (
    <AsyncPanel result={result} empty="No health report available.">
      {(report) => (
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              {/* A repo path has no spaces to wrap at, so it may break anywhere; the title carries
                  the full value for hover and screen readers (#89). */}
              <CardTitle className="wrap-anywhere" title={report.repo ?? undefined}>
                {report.repo}
              </CardTitle>
              <CardDescription>workledger {report.cli}</CardDescription>
            </CardHeader>
          </Card>

          <section aria-labelledby="health-harnesses" className="flex flex-col gap-2">
            <h3 id="health-harnesses" className="text-sm font-semibold text-muted-foreground">
              Harnesses
            </h3>
            <ul className="flex flex-col gap-2">
              {report.harnesses.map((entry) => (
                <li key={entry.harness} aria-label={entry.harness}>
                  <Row
                    status={harnessStatus(entry)}
                    label={entry.harness}
                    detail={harnessDetail(entry)}
                    problems={harnessProblems(entry)}
                  />
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="health-ledger" className="flex flex-col gap-2">
            <h3 id="health-ledger" className="text-sm font-semibold text-muted-foreground">
              Index and config
            </h3>
            <ul className="flex flex-col gap-2">
              <li aria-label="Index">
                <Row
                  status={indexStatus(report.index)}
                  label="Index"
                  detail={`${report.index.path} · ${formatBytes(report.index.bytes)} · ${count(report.index.openSessions, "open session")}`}
                />
              </li>
              <li aria-label="Config">
                <Row
                  status={configStatus(report.config)}
                  label="Config"
                  detail={report.config.valid ? "valid" : "invalid"}
                  problems={report.config.problems}
                />
              </li>
              <li aria-label="Last hook">
                <Row
                  status={lastHookStatus(report.lastHookAt)}
                  label="Last hook"
                  detail={report.lastHookAt ?? "no hook has fired yet"}
                />
              </li>
            </ul>
          </section>
        </div>
      )}
    </AsyncPanel>
  );
}

function Row({
  status,
  label,
  detail,
  problems = [],
}: {
  status: Status;
  label: string;
  detail: string;
  problems?: string[];
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <CardTitle>{label}</CardTitle>
        </div>
        <CardDescription className="wrap-anywhere" title={detail}>
          {detail}
        </CardDescription>
      </CardHeader>
      {problems.length === 0 ? null : (
        <CardContent>
          {/* A warn row's complaints are not faults, so they must not be painted as one. */}
          <ul
            className={`flex flex-col gap-1 text-sm ${status === "broken" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * `success` is a token but not yet a `Badge` variant, so the ok reading names the token directly
 * rather than growing the shared primitive from inside one feature. Still tokens, never a hex.
 */
function StatusBadge({ status }: { status: Status }) {
  if (status === "broken") return <Badge variant="destructive">broken</Badge>;
  if (status === "warn") return <Badge variant="warning">warn</Badge>;
  return (
    <Badge variant="outline" className="border-transparent bg-success text-success-foreground">
      ok
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
