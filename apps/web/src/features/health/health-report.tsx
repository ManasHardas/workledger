import { useState } from "react";

import { AsyncPanel } from "../../components/async-panel.js";
import { Badge } from "../../components/ui/badge.js";
import { ListRow, RowList, RowSection, RowTitle } from "../../components/ui/list-row.js";
import { Panel } from "../../components/ui/panel.js";
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

/** One reading, as the list holds it: a row plus everything the row does not have room for. */
interface Reading {
  key: string;
  status: Status;
  label: string;
  detail: string;
  problems: string[];
}

/**
 * `workledger doctor` as a page, on the shell's list rhythm (#134): every harness, the index, the
 * config, and when a hook last fired (design spec §8 "Health").
 *
 * Each row is its reading and its name; the probe behind it — the binary, the versions, the store,
 * the complaints doctor made — is long detail, so it is in the right panel (rule 3), which the
 * row's name opens. A broken row is findable from the chips alone, without reading the prose.
 */
export function HealthReport() {
  const result = useLiveHealth();
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <AsyncPanel result={result} empty="No health report available.">
      {(report) => {
        const harnesses: Reading[] = report.harnesses.map((entry) => ({
          key: `harness:${entry.harness}`,
          status: harnessStatus(entry),
          label: entry.harness,
          detail: harnessDetail(entry),
          problems: harnessProblems(entry),
        }));
        const machine: Reading[] = [
          {
            key: "index",
            status: indexStatus(report.index),
            label: "Index",
            detail: `${report.index.path} · ${formatBytes(report.index.bytes)} · ${count(report.index.openSessions, "open session")}`,
            problems: [],
          },
          {
            key: "config",
            status: configStatus(report.config),
            label: "Config",
            detail: report.config.valid ? "valid" : "invalid",
            problems: report.config.problems,
          },
          {
            key: "last-hook",
            status: lastHookStatus(report.lastHookAt),
            label: "Last hook",
            detail: report.lastHookAt ?? "no hook has fired yet",
            problems: [],
          },
        ];
        const opened = [...harnesses, ...machine].find((row) => row.key === openKey) ?? null;

        return (
          <div className="flex min-w-0 flex-col gap-5">
            {/* A repo path has no spaces to wrap at, so it may break anywhere; the title carries
                the full value for hover and screen readers (#89). */}
            <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              <span className="wrap-anywhere font-mono" title={report.repo ?? undefined}>
                {report.repo}
              </span>
              <span className="tabular-nums">workledger {report.cli}</span>
            </p>

            <RowSection id="health-harnesses" title="Harnesses" count={harnesses.length}>
              <RowList aria-label="Harnesses">
                {harnesses.map((row) => (
                  <HealthRow
                    key={row.key}
                    reading={row}
                    selected={openKey === row.key}
                    onOpen={() => setOpenKey(row.key)}
                  />
                ))}
              </RowList>
            </RowSection>

            <RowSection id="health-ledger" title="Index and config">
              <RowList aria-label="Index and config">
                {machine.map((row) => (
                  <HealthRow
                    key={row.key}
                    reading={row}
                    selected={openKey === row.key}
                    onOpen={() => setOpenKey(row.key)}
                  />
                ))}
              </RowList>
            </RowSection>

            <HealthPanel reading={opened} onClose={() => setOpenKey(null)} />
          </div>
        );
      }}
    </AsyncPanel>
  );
}

/**
 * One reading as a row: the chip, the name, and — when doctor complained — how many complaints
 * there are. The complaints themselves are in the panel.
 */
function HealthRow({
  reading,
  selected,
  onOpen,
}: {
  reading: Reading;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <ListRow selected={selected} aria-label={reading.label}>
      <StatusBadge status={reading.status} />
      <RowTitle aria-haspopup="dialog" onClick={onOpen}>
        {reading.label}
      </RowTitle>
      {reading.problems.length === 0 ? null : (
        <span className="shrink-0 text-xs tabular-nums text-subtle-foreground">
          {count(reading.problems.length, "problem")}
        </span>
      )}
    </ListRow>
  );
}

/** The probe behind a reading: doctor's own detail line, and its complaints verbatim. */
function HealthPanel({ reading, onClose }: { reading: Reading | null; onClose: () => void }) {
  return (
    <Panel
      open={reading !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={reading?.label ?? ""}
      description={reading === null ? undefined : <span>{reading.status}</span>}
    >
      {reading === null ? null : (
        <div className="flex flex-col gap-4 text-sm">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
              Probe
            </p>
            <p className="wrap-anywhere text-xs text-muted-foreground">{reading.detail}</p>
          </div>
          {reading.problems.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-subtle-foreground">
                Problems
              </p>
              {/* A warn row's complaints are not faults, so they must not be painted as one. */}
              <ul
                aria-label="Problems"
                className={`flex flex-col gap-1 text-sm ${reading.status === "broken" ? "text-destructive" : "text-muted-foreground"}`}
              >
                {reading.problems.map((problem) => (
                  <li key={problem} className="wrap-anywhere">
                    {problem}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

/**
 * `success` is a token but not yet a `Badge` variant, so the ok reading names the token directly
 * rather than growing the shared primitive from inside one feature. Still tokens, never a hex.
 */
function StatusBadge({ status }: { status: Status }) {
  if (status === "broken") return <Badge variant="destructive" className="shrink-0">broken</Badge>;
  if (status === "warn") return <Badge variant="warning" className="shrink-0">warn</Badge>;
  return (
    <Badge variant="outline" className="shrink-0 border-transparent bg-success text-success-foreground">
      ok
    </Badge>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? "" : "s"}`;
}
