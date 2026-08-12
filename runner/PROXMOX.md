# Running the pipeline on Proxmox

Two small VMs turn the lab into the pipeline's infrastructure: one runs CI,
one runs staging. Both are disposable by design — a snapshot taken when clean
is the rollback for anything a job ever does to them.

```
Proxmox host
├── VM  ci-runner      gates workflow, ephemeral runner containers
├── VM  opsmind-stg    the new OpsMind, auto-deployed from main
└── (later, optional)  agent VM for long autonomous Claude Code runs
```

Use VMs, not LXC containers — Docker inside LXC needs nesting privileges that
weaken exactly the isolation you are here for.

---

## VM 1 · ci-runner

**Create:** Ubuntu Server 24.04 · 2 vCPU · 4 GB RAM · 40 GB disk · static IP on
your lab network. (If you keep a cloud-init template, clone it; otherwise the
ISO install is ten minutes.)

**Provision:**

```bash
# on the VM
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# copy the runner/ directory from the repo onto the VM, then:
cd runner
cp .env.example .env        # GITHUB_OWNER, GITHUB_REPO, RUNNER_PAT
docker compose up -d
```

The PAT is a **fine-grained token scoped to this one repository** with only
*Administration: Read and write* — it exists solely to register the runner.
Never an org-wide or classic token: whatever lands on a CI box should be worth
as little as possible.

**Route the gates here:** repository → Settings → Secrets and variables →
Actions → Variables → `GATES_RUNNER` = `self-hosted`. Delete the variable and
the next run is back on GitHub-hosted — that is the entire rollback.

**Snapshot:** in Proxmox, take `runner-clean` now. Anything ever looks wrong on
this VM, roll back rather than debug — it holds nothing worth preserving.

---

## VM 2 · opsmind-stg

**Create:** Ubuntu Server 24.04 · 4 vCPU · 8 GB RAM · 60 GB disk · static IP.
Install Docker the same way.

This VM receives the new OpsMind on every merge to main, which is what makes
the parallel-build strategy real: the team clicks around staging and gives
feedback while the old system still runs, and cutover day is a data migration
rather than a reveal.

**Deployment is pull-shaped and needs no SSH keys anywhere:** a second runner
on *this* VM carries the label `staging`, and the deploy workflow simply runs
where that label is. Same compose stack, one changed line:

```bash
# runner/.env on THIS VM — add:
LABELS_OVERRIDE=self-hosted,linux,staging
```

and in its `docker-compose.yml`, set `LABELS: ${LABELS_OVERRIDE}` for the
runner service. The gates runner and the staging runner never share a machine,
so a gates job can never touch the staging database.

The application compose file, Dockerfile and deploy workflow do not exist yet —
they are the `staging-deploy` task in the backlog, built by the pipeline itself
right after the scaffold. Application secrets live in an env file on this VM,
never in the repository.

**Backups:** schedule a nightly `vzdump` of this VM in Proxmox (Datacenter →
Backup). Once anonymised-but-realistic data lives here, that job is your
pre-cutover backup story.

---

## What this changes about earlier advice

**`claude-fix` can eventually move on-lab.** The reason it stayed on
GitHub-hosted was that it executes agent-written code, and that did not belong
next to your credentials. A dedicated VM that contains nothing but a runner —
snapshotted, rollback-able — is an acceptable home for it. Keep it hosted for
the first weeks anyway: change one variable at a time, and move it only once
the ci-runner VM has been boringly stable.

**The workstation stays out of it entirely.** Your WSL machine goes back to
being where *you* run Claude Code interactively, which is the one workload that
genuinely benefits from being next to you.

---

## The one line that still holds

No runner VM ever mounts `/var/run/docker.sock` into a job container, and no
runner gets an org-wide token. Everything else about this setup is
reversible; those two mistakes are not.
