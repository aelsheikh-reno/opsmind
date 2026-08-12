# Self-hosted gates runner

> Putting this on a Proxmox VM instead of your workstation? Read
> `PROXMOX.md` — same stack, better home, plus the staging VM that goes
> with it.

Runs the `gates` workflow on your machine inside an ephemeral container —
GitHub's clean-room behaviour, your hardware, none of your files.

## Start it

```bash
cd runner
cp .env.example .env    # fill in the three values
docker compose up -d
```

The runner appears under the repository's Settings → Actions → Runners within a
minute. `EPHEMERAL=1` plus `restart: always` means each job gets a factory-fresh
container: the runner exits after one job and compose immediately recreates it.

## Route the gates to it

Set a repository **variable** (Settings → Secrets and variables → Actions →
Variables):

```
GATES_RUNNER = self-hosted
```

`gates.yml` reads this: set, it runs here; unset or deleted, it runs on
GitHub-hosted. One variable is the whole toggle, and deleting it is the instant
rollback if your machine is off.

## What deliberately stays in the cloud

`claude-review` and `claude-fix` remain on GitHub-hosted runners. `claude-fix`
executes agent-written code and pushes commits — that belongs on a VM that is
destroyed afterwards, not on the machine holding your credentials. This is a
choice, not a limitation.

## The line not to cross

Never add `/var/run/docker.sock` to the runner service. Every tutorial
suggesting it is giving CI jobs root on your machine. This stack is arranged —
Postgres as a sidecar, container-jobs kept in the cloud — precisely so the
socket is never needed.

## When the machine is off

Jobs queue until the runner returns, or delete the `GATES_RUNNER` variable and
the very next run goes back to GitHub-hosted.
