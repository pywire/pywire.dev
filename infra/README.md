# Infra

Terraform for pywire.dev Cloudflare resources. State lives in R2 (bucket
`pywire-tfstate`, key `pywire.dev.tfstate`, native S3 locking — created
manually once, chicken-and-egg). **Terraform >= 1.10 required**:

```sh
brew install hashicorp/tap/terraform
```

## Daily flow

- PRs touching `infra/` or `worker/` get a **plan comment** (never fails the PR).
- Pushing to `main` with drift fails the **Infra plan** job → run **Infra apply**
  (Actions → Infra apply → Run workflow) to converge.
- A weekly check opens a "Terraform drift on main" issue if live state diverges.

## Local runs

`terraform.tfvars` is gitignored (token + private emails). Non-secret values
are committed in `infra.auto.tfvars`; your local `terraform.tfvars` overrides
them. To init against the R2 backend, drop the R2 access keys into a
gitignored `backend.secrets`:

```sh
cat > backend.secrets <<'EOF'
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
EOF
set -a; . ./backend.secrets; set +a; rm backend.secrets
terraform init
terraform plan   # reads TF_VARs from terraform.tfvars
```

## Secrets (repo settings)

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | provider auth (Pages, Workers, DNS, Routes, Rulesets, Email Routing, R2 Storage — all Edit) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | state backend (Object Read & Write, scoped to `pywire-tfstate` only) |
| `EMAIL_FORWARDING_RULES` / `MAINTAINER_EMAILS` | private tfvars values for CI |

## Break glass

- Stuck lock: `terraform force-unlock <LOCK_ID>` (lock object is
  `pywire.dev.tfstate-lock.info` in the bucket).
- The first apply after the 2026-09 remote-state migration also converges the
  pre-existing `pywire-docs` Pages project drift (GitHub repo renamed
  `pywire-core` → `pywire`; deploys are wrangler-driven, so the connection is inert).
