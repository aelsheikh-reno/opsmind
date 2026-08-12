# OpsMind runbook — zero to running pipeline, copy-paste

Every block below pastes whole into a terminal. Edit **only** Block 0.
Browser appears exactly four times, each marked 🌐. Phases A–D get the
pipeline running on GitHub-hosted runners today; Phase E moves CI onto the
Proxmox lab and can happen any time later.

---

## Block 0 · Set once (WSL terminal)

Edit the five values, paste, done. Every later block reads these.

```bash
export GITHUB_OWNER="YOUR_GITHUB_USERNAME_OR_ORG"
export REPO="opsmind"
export PIPELINE_ZIP="/mnt/c/Users/YOUR_WINDOWS_USER/Downloads/opsmind-pipeline.zip"
export LEGACY_ZIP="/mnt/c/Users/YOUR_WINDOWS_USER/Downloads/opsmind-main.zip"
export REPO_DIR="$HOME/code/opsmind"

# make these survive new terminals
cat >> ~/.bashrc <<EOF
export GITHUB_OWNER="$GITHUB_OWNER" REPO="$REPO" REPO_DIR="$REPO_DIR"
EOF
```

---

## Phase A · Tools (WSL, once)

**A1 — base packages, Node 20, GitHub CLI, Claude Code**

```bash
sudo apt-get update -qq && sudo apt-get install -y -qq git curl unzip ca-certificates

# Node 20 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
nvm install 20 && nvm alias default 20

# GitHub CLI
sudo mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt-get update -qq && sudo apt-get install -y -qq gh

# Claude Code
npm install -g @anthropic-ai/claude-code
node -v && gh --version | head -1 && claude --version
```

**A2 — 🌐 sign in to GitHub** (browser opens; accept defaults with Enter)

```bash
gh auth login --hostname github.com --git-protocol https --web
```

**A3 — 🌐 sign in to Claude Code** (first run opens the browser; after login,
exit with `/exit`)

```bash
claude
```

---

## Phase B · Assemble and push the repository

**B1 — unpack pipeline + legacy into one tree**

```bash
mkdir -p "$REPO_DIR" && cd "$REPO_DIR"

# pipeline files into the repo root (includes .claude, .github, .gitignore)
rm -rf /tmp/_pl && unzip -qo "$PIPELINE_ZIP" -d /tmp/_pl
cp -r /tmp/_pl/pipeline/. "$REPO_DIR"/

# legacy source as the read-only oracle
rm -rf /tmp/_lg reference/legacy && mkdir -p reference /tmp/_lg
unzip -qo "$LEGACY_ZIP" -d /tmp/_lg
mv "$(find /tmp/_lg -mindepth 1 -maxdepth 1 -type d | head -1)" reference/legacy

# strip what must never be committed from the legacy copy
rm -rf reference/legacy/{.git,node_modules,.next,uploads}
find reference/legacy -name ".env*" -delete
find reference/legacy \( -name "*.sql" -o -name "*.dump" -o -name "*.sql.gz" \) -delete

ls .claude .github scripts tasks runner reference/legacy >/dev/null && echo "TREE OK"
```

**B2 — first commit, create the private repo, push**

```bash
cd "$REPO_DIR"
git init -b main
git add -A
git commit -m "chore: pipeline + legacy reference baseline"
gh repo create "$GITHUB_OWNER/$REPO" --private --source=. --push
```

**B3 — repository behaviour: squash-only, auto-merge on, gates required**

```bash
gh repo edit "$GITHUB_OWNER/$REPO" \
  --enable-auto-merge \
  --enable-squash-merge \
  --delete-branch-on-merge \
  --enable-merge-commit=false \
  --enable-rebase-merge=false

gh api -X PUT "repos/$GITHUB_OWNER/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["gates"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo "PROTECTION OK"
```

No human approval is required to merge — the gates are the approval. Your
review is reserved for PRs the pipeline itself parks (`money` / `compliance`).

---

## Phase C · Subscription token for the CI workflows

**C1 — 🌐 generate** (browser auth; the terminal then prints `sk-ant-oat01-…`;
copy it)

```bash
claude setup-token
```

**C2 — store as the repo secret** (paste the token when prompted, then Enter)

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$GITHUB_OWNER/$REPO"
```

---

## Phase D · Run the pipeline

**D1 — first three tasks** (each command is one full task: implement → test →
gates → review → PR; low-risk PRs auto-merge on green)

```bash
cd "$REPO_DIR"
claude "/build-task scaffold-project"
```

When it finishes and the PR merges:

```bash
claude "/build-task harness-differential"
claude "/build-task staging-deploy"
```

**D2 — daily loop, forever after**

```bash
cd "$REPO_DIR" && claude "/next"
```

Repeat `claude "/next"` as often as you like. It picks the next unblocked task
and runs it end to end. It stops and tells you when it needs you: a differential
difference to adjudicate, a spec ambiguity, or a `money`/`compliance` PR
waiting for your merge click:

```bash
gh pr list --repo "$GITHUB_OWNER/$REPO"          # anything parked for you
gh pr merge <NUMBER> --squash --delete-branch    # your approval, when satisfied
```

---

## Phase E · Move CI onto the Proxmox lab (any time; optional today)

### E1 — on the **Proxmox host** shell (create the two VMs)

Edit the four network values, then paste the whole block.

```bash
export STORAGE="local-lvm" BRIDGE="vmbr0"
export GW="192.168.1.1"                # your lab gateway
export CI_IP="192.168.1.60"            # ci-runner
export STG_IP="192.168.1.61"           # opsmind-stg
export CI_ID=160 STG_ID=161 VMPASS="Reno-Lab-2026!"

cd /root
wget -qN https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img

make_vm () { # id name cores mem ip
  qm create "$1" --name "$2" --cores "$3" --memory "$4" \
     --net0 virtio,bridge=$BRIDGE --agent 1 --scsihw virtio-scsi-single
  qm set "$1" --scsi0 ${STORAGE}:0,import-from=/root/noble-server-cloudimg-amd64.img
  qm set "$1" --ide2 ${STORAGE}:cloudinit --boot order=scsi0 --serial0 socket --vga serial0
  qm set "$1" --ciuser ubuntu --cipassword "$VMPASS" --ipconfig0 "ip=$5/24,gw=$GW"
  qm resize "$1" scsi0 +36G
  qm start "$1"
}
make_vm $CI_ID  ci-runner   2 4096 $CI_IP
make_vm $STG_ID opsmind-stg 4 8192 $STG_IP

# nightly backup of staging at 02:00
echo "0 2 * * * root vzdump $STG_ID --mode snapshot --storage local --compress zstd --quiet 1" \
  > /etc/cron.d/opsmind-stg-backup
echo "VMS UP: ssh ubuntu@$CI_IP / ubuntu@$STG_IP  (password: $VMPASS)"
```

### E2 — 🌐 one PAT for runner registration

GitHub → Settings → Developer settings → Fine-grained tokens → Generate new:
**this repository only**, permission **Administration: Read and write**,
90-day expiry. Copy the `github_pat_…` value.

### E3 — from **WSL**: provision the CI runner VM

```bash
export CI_IP="192.168.1.60"                      # same as E1
read -srp "Paste the runner PAT: " RUNNER_PAT; echo

scp -r "$REPO_DIR/runner" ubuntu@$CI_IP:~/
ssh ubuntu@$CI_IP "bash -s" <<EOF
set -e
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
cd ~/runner
cat > .env <<ENV
GITHUB_OWNER=$GITHUB_OWNER
GITHUB_REPO=$REPO
RUNNER_PAT=$RUNNER_PAT
ENV
sudo docker compose up -d
EOF

gh variable set GATES_RUNNER --repo "$GITHUB_OWNER/$REPO" --body "self-hosted"
echo "GATES NOW RUN ON THE LAB — delete the variable to fall back:"
echo "  gh variable delete GATES_RUNNER --repo $GITHUB_OWNER/$REPO"
```

Back on the **Proxmox host**, freeze the clean state:

```bash
qm snapshot 160 runner-clean
```

### E4 — from **WSL**: staging runner on the second VM
(the app itself arrives automatically once the `staging-deploy` PR from D1 has
merged — this just gives deploys a place to land)

```bash
export STG_IP="192.168.1.61"
read -srp "Paste the same runner PAT: " RUNNER_PAT; echo

scp -r "$REPO_DIR/runner" ubuntu@$STG_IP:~/
ssh ubuntu@$STG_IP "bash -s" <<EOF
set -e
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
cd ~/runner
cat > .env <<ENV
GITHUB_OWNER=$GITHUB_OWNER
GITHUB_REPO=$REPO
RUNNER_PAT=$RUNNER_PAT
LABELS_OVERRIDE=self-hosted,linux,staging
ENV
sudo docker compose up -d
EOF
echo "STAGING RUNNER UP — merges to main will deploy here"
```

---

## When something needs you — the whole list

| Signal | Your action |
|---|---|
| Claude prints a **DIFFERENCE** with a cause line | Answer which behaviour is correct — one sentence |
| A PR is parked as `money`/`compliance` | Read the PR body's assertions, `gh pr merge <N> --squash --delete-branch` |
| Claude reports a **spec ambiguity** | Answer it, or say "update the architecture doc to X" |
| Three gate failures on one task | The task or spec is wrong — read Claude's report, adjust, rerun |

Everything else is the machines' problem.
