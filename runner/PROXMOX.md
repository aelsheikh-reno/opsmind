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
where that label is.

**This runner is installed natively on the VM, not in a container** — unlike
the gates runner. The deploy job's entire job is to run `docker compose` on
this machine, and `runner/docker-compose.yml` deliberately gives its runner no
Docker at all. The two cannot both hold: a containerised runner here would have
to mount `/var/run/docker.sock`, which the rule at the bottom of this document
forbids outright. Installing the runner on the host instead keeps that rule
literally true — there is no job container for the socket to be mounted into —
and jobs use the host's Docker directly.

```bash
# on opsmind-stg, as a non-root user in the docker group
mkdir -p ~/actions-runner && cd ~/actions-runner
curl -o runner.tar.gz -L https://github.com/actions/runner/releases/latest/download/actions-runner-linux-x64.tar.gz
tar xzf runner.tar.gz
./config.sh --url https://github.com/<owner>/opsmind \
            --token <registration token from repo Settings → Actions → Runners> \
            --labels self-hosted,linux,staging \
            --name opsmind-stg --unattended
sudo ./svc.sh install && sudo ./svc.sh start
```

The trade this makes is explicit: the gates runner is ephemeral and rebuilt
clean after every job, and this one is not — it persists between deploys. That
is acceptable *here* and nowhere else, because this VM exists to hold a running
application and its database between deploys anyway; a clean room would defeat
its purpose. It is snapshotted and disposable at the VM level instead, which is
the rollback that matters for it.

Say the other half of that trade out loud: a natively installed runner whose
user is in the `docker` group has host-root-equivalent access to Docker, which
is *broader* than the socket mount the rule below forbids, not narrower. The
privilege moved onto the host runner; it was not removed. What makes it
acceptable is the blast radius rather than the permission — this VM is
dedicated to staging, snapshotted and disposable, holds no production data, and
only the deploy workflow targets the `staging` label, so nothing else ever runs
here to abuse it. Made deliberately, on this machine, on those conditions; on a
machine where any of them stops being true, it is the mistake the last section
names.

The gates runner and the staging runner never share a machine, so a gates job
can never touch the staging database. Keep the `staging` label off every other
runner: the deploy workflow pins `runs-on: [self-hosted, linux, staging]`, and
a second machine carrying that label is the one way the deploy could land
somewhere it should not.

The application stack is `docker-compose.staging.yml` at the repository root —
Postgres, the app, and nginx in front of it, plus a `migrate` service that must
run `prisma migrate deploy` to completion before the app container is created.
Its image builds here from the repo `Dockerfile` rather than being pulled, so
there is no registry credential on this VM to hold or rotate.
`.github/workflows/deploy-staging.yml` drives all of it on every push to main,
pinned to the `staging` label above. Application secrets live in an env file on
this VM, `/srv/opsmind/staging.env`, never in the repository: compose reads it
with `env_file` and the workflow only checks that it exists, so an absent file
stops the deploy loudly instead of booting the stack on defaults.

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
