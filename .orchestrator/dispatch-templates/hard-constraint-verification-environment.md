# HARD CONSTRAINT — Verification environment (PERMANENT)

## Body (paste verbatim into dispatch briefs)

> You MUST verify your changes on the host (with locally-installed runtime tooling) OR in an ephemeral container via `docker compose run --rm <service> <cmd>`. You MUST NOT:
> - Run `docker cp` to push files into a running container.
> - Run `docker exec` against a running container to install packages, edit files, or otherwise mutate its state.
> - Modify any image-built artifact at runtime.
>
> Running containers are immutable for your purposes. If you need a dependency that's only available inside a container image, either (a) add it to the Dockerfile and rebuild via `docker compose build`, or (b) verify on the host with the same package version, or (c) use `docker compose run --rm` for an ephemeral container that's discarded after the command exits.
>
> State your verification path explicitly in the PR description (e.g., "Verified on host with python3.11 + venv" or "Verified via `docker compose run --rm api alembic upgrade head`"). Reviewers will reject PRs whose verification steps imply running-container modification.

## Why permanent

Real-project history: early sessions repeatedly ran `docker cp` / `docker exec` to verify changes, then committed code that didn't survive a fresh `docker compose up --build` because the changes only existed in a running container's overlay filesystem.

This clause makes the verification path explicit in the PR description. Reviewers reject PRs whose verification implies running-container mutation. After encoding this clause, projects observed 20+ consecutive sessions clean with zero verification-environment breaches.

## How to apply

Include verbatim in EVERY build-agent dispatch brief (backend, frontend, infra alike). The clause body is identical regardless of agent role.

In the PR description, build agents include:

```markdown
- **HARD CONSTRAINT (verification environment):** ✅ Verified on host
  with Node ≥ 22 + pnpm ≥ 10 + venv (no `docker cp` / `docker exec`).
```

OR

```markdown
- **HARD CONSTRAINT (verification environment):** ✅ Verified via
  `docker compose run --rm <service> <cmd>` (ephemeral; no running-container
  mutation).
```

## Doesn't apply to

- Pure-doc PRs (no code to verify).
- Plan / spec PRs (no executable changes).

For all other PR classes, this clause is non-negotiable.
