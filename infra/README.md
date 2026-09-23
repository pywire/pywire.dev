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
| `CLOUDFLARE_API_TOKEN` | provider auth — see [Token permissions](#token-permissions) for the exact grant list |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | state backend (Object Read & Write, scoped to `pywire-tfstate` only) |
| `EMAIL_FORWARDING_RULES` / `MAINTAINER_EMAILS` | private tfvars values for CI |

## Token permissions

The `CLOUDFLARE_API_TOKEN` must be an **account token** (verify: passes
`/accounts/{id}/tokens/verify`, fails `/user/tokens/verify`). Current picker
names (2026-09) — dashboard says *Write*, older docs say *Edit*:

| Scope | Permission |
|---|---|
| Account | Pages: Write |
| Account | Workers R2 Storage: Write |
| Account | Workers Scripts: Write |
| Account | Email Routing Addresses: Write |
| Account | Account Rulesets: Write |
| Zone (pywire.dev) | Email Routing Rules: Write |
| Zone (pywire.dev) | Workers Routes: Write |
| Zone (pywire.dev) | DNS: Write |
| Zone (pywire.dev) | Zone WAF: Write |
| Zone (pywire.dev) | Zone Settings: **Read AND Write** |

Wrinkles found the hard way:

- No "Zone Rulesets" permission exists in the current picker — zone rulesets
  (`cloudflare_ruleset`) are gated by Zone WAF + Account Rulesets.
- `email_routing_settings` is gated by **Zone Settings**, not the Email
  Routing permissions, and its read check needs Zone Settings **Read set
  explicitly** — Write alone does not imply Read for that endpoint (403,
  code 10000).

## Break glass

- Stuck lock: `terraform force-unlock <LOCK_ID>` (lock object is
  `pywire.dev.tfstate-lock.info` in the bucket).

## Known wrinkles

- **Pages projects still carry a live GitHub connection.** Both projects are
  deployed by GitHub Actions (direct upload), so the connection is vestigial
  (builds disabled since `53218bf`), but the Cloudflare API **cannot detach it**
  — `PATCH source: null` succeeds and is silently ignored. Converging to the
  direct-upload config requires deleting + recreating both projects (deployments
  wiped; both sites 404 until the next deploy). Coordinate: merge the deploy
  workflow fixes first, then recreate, then dispatch both deploys.
- **`build_config` phantom diffs** (`build_caching`, `web_analytics_*` "known
  after apply") appear on every plan with provider 5.16. Declare-and-keep is the
  workaround; they should resolve when the projects are recreated.
- **Provider upgrades past 5.16 are blocked**: 5.24+ cannot read this state's
  `email_routing_settings` (new `support_subaddress` field vs old state objects).
  To upgrade: `terraform state rm` the four email-routing resources, re-import
  them with the new provider, then bump the lock.
