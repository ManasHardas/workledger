# Runbook — <Scenario name>

**Triggered when:** <one-line condition that fires this runbook — alert name, error pattern, user-report pattern>.

**Owner:** <agent role responsible for the surface — Backend / Infra / SRE>.

**Severity:** <SEV-1 / SEV-2 / SEV-3 — see severity definitions in your incident-response doc>.

**Last reviewed:** <YYYY-MM-DD>.

---

## Symptoms

What an operator sees when this scenario is in progress. Be concrete — error messages, dashboard signals, user-visible behavior. Bullet list:

- <observable 1>
- <observable 2>

---

## Diagnose

Sequence of checks to confirm the runbook applies (vs. a similar-looking scenario that needs a different runbook). Steps in order:

1. **<Check 1>.** Command or query to run. Expected output if this runbook applies.
2. **<Check 2>.** ...
3. **Confirm scope** — is this a single-user blast radius, a tenant-level issue, or system-wide? Determines whether to escalate before remediating.

---

## Remediate

Steps to restore service. Prefer reversible steps first; destructive operations explicitly flagged. Each step lists: command, expected effect, verification step.

1. **<Step 1>.**
   - Command: `<command>`
   - Expected effect: <what should change>
   - Verify: <how to confirm it worked>
2. **<Step 2>.** ...

If any step's verification fails, STOP and escalate (see §Escalate if below). Do not improvise past a failed remediation step in a SEV-1.

---

## Escalate if

- <Condition that means remediation isn't working and a human owner needs to take over>.
- Remediation step N fails verification (per §Remediate above).
- Blast radius widens during remediation.
- Scenario recurs within <window> of remediation.

Escalation channel: <pager / chat channel / on-call rotation reference>.

---

## Post-incident

After service is restored:

1. **Open a `type/incident` issue** with: timeline, root cause hypothesis, remediation steps applied, time-to-detect / time-to-remediate.
2. **Schedule a postmortem** if SEV-1 or SEV-2, or if the runbook was insufficient and improvisation was required.
3. **Update this runbook** if any step was wrong, missing, or ambiguous during the actual incident. Bump §Last reviewed.

---

## Per-surface sub-blocks (optional, for runbooks covering >1 component)

When this scenario can fire on multiple components (e.g. multiple workers, multiple endpoints), document each surface separately under §Symptoms / §Diagnose / §Remediate with a sub-heading per surface:

### Surface: <component name>

- **Trigger condition:** <when this surface fires>
- **Expected state transitions:** <state machine deltas>
- **Failure modes:** <list>
- **Recovery procedure:** <steps>
- **Spec-drift watch:** <what would invalidate this runbook>
- **Cross-references:** <other runbooks, contract docs, incident postmortems>

---

## Cross-references

- Contract doc: <path or URL>
- Phase spec: <path>
- Related runbooks: <list>
- Recent postmortems: <list with dates>
