# Infra

Terraform for pywire.dev Cloudflare resources. State lives in R2 (bucket
`pywire-tfstate`, key `pywire.dev.tfstate`, native S3 locking — created
manually once, chicken-and-egg). **Terraform >= 1.10 required**:

```sh
brew install hashicorp/tap/terraform
```

## Daily flow

- PRs touching `infra/` or `worker/` get a **plan comment** (never fails the PR).
  Plans use read-only credentials and `-lock=false` (see
  [Credentials and environments](#credentials-and-environments)).
- Pushing to `main` reports unapplied changes as a notice (only a plan error
  fails) → run **Infra apply** (Actions → Infra apply → Run workflow) to
  converge.
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

## Credentials and environments

Every Cloudflare credential is scoped to one job. Anything a pull request can
run (its build, its Terraform, its copy of a workflow) only ever sees
read-only credentials; write credentials live in environments that only
`main` can use.

| Workflow | Job | Environment | Cloudflare credential |
|---|---|---|---|
| `ci.yml` | build, tests | — | none |
| `deploy.yml` | `build` (runs `pnpm install`/PR code) | — | none; uploads `site/dist` as an artifact |
| `deploy.yml` | `deploy-production` (push to `main`) | `production` | `CLOUDFLARE_PAGES_TOKEN` |
| `deploy-nightly.yml` | `deploy-nightly` (`workflow_run` after a PR build) | `nightly` | `CLOUDFLARE_PAGES_TOKEN` |
| `infra-plan.yml` | `plan` (PRs, `main`, weekly) | — | `CLOUDFLARE_READONLY_TOKEN`, read-only R2 keys |
| `infra-apply.yml` | `apply` (manual, `main`) | `production` | `CLOUDFLARE_API_TOKEN`, read/write R2 keys |

Deploy jobs never install dependencies from the repo: they download the
artifact the secret-free build job produced and run a pinned `wrangler`.
`deploy-nightly.yml` is triggered by `workflow_run`, which always runs the
file as it is on `main`, so a PR can change what is built for nightly but not
what the deploy job does with the token.

### Environments (Settings → Environments)

| Environment | Deployment branches | Secrets |
|---|---|---|
| `production` | Selected branches: `main` only (optionally add required reviewers) | `CLOUDFLARE_PAGES_TOKEN`, `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| `nightly` | Selected branches: `main` only (`workflow_run` runs on `main`) | `CLOUDFLARE_PAGES_TOKEN` |

The branch restriction is what keeps the write tokens away from other
branches: a workflow on any other branch (a PR, or a manual dispatch of a
modified `infra-apply.yml`) cannot enter the environment, so it never gets
its secrets. Don't also keep these names as repository secrets — a repository
secret is readable from every branch.

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | account for `wrangler pages deploy` (not sensitive; it is also in `infra.auto.tfvars`) |
| `CLOUDFLARE_READONLY_TOKEN` | provider auth for `terraform plan` — the read-only grant list below |
| `R2_READONLY_ACCESS_KEY_ID` / `R2_READONLY_SECRET_ACCESS_KEY` | state backend for plans (Object Read only, scoped to `pywire-tfstate`) |
| `EMAIL_FORWARDING_RULES` / `MAINTAINER_EMAILS` | private tfvars values for CI |

`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (Object Read & Write, scoped to
`pywire-tfstate` only) are `production` environment secrets.

## Token permissions

All three are **account tokens** (verify: passes
`/accounts/{id}/tokens/verify`, fails `/user/tokens/verify`), restricted to
this account and, for zone permissions, to the `pywire.dev` zone. Current
picker names (2026-09) — dashboard says *Write*, older docs say *Edit*.

**`CLOUDFLARE_PAGES_TOKEN`** (site deploys): Account → Cloudflare Pages:
Write, nothing else. Cloudflare cannot scope it to one project or branch,
so it can still publish any Pages project in the account; that is why it
only lives in environments restricted to `main`.

**`CLOUDFLARE_API_TOKEN`** (`terraform apply`) and
**`CLOUDFLARE_READONLY_TOKEN`** (`terraform plan`) have the same grants, at
*Write* and *Read* respectively:

| Scope | `CLOUDFLARE_API_TOKEN` | `CLOUDFLARE_READONLY_TOKEN` |
|---|---|---|
| Account | Pages: Write | Pages: Read |
| Account | Workers R2 Storage: Write | Workers R2 Storage: Read |
| Account | Workers Scripts: Write | Workers Scripts: Read |
| Account | Email Routing Addresses: Write | Email Routing Addresses: Read |
| Account | Account Rulesets: Write | Account Rulesets: Read |
| Zone (pywire.dev) | Email Routing Rules: Write | Email Routing Rules: Read |
| Zone (pywire.dev) | Workers Routes: Write | Workers Routes: Read |
| Zone (pywire.dev) | DNS: Write | DNS: Read |
| Zone (pywire.dev) | Zone WAF: Write | Zone WAF: Read |
| Zone (pywire.dev) | Zone Settings: **Read AND Write** | Zone Settings: Read |

Before relying on a new read-only token, run `terraform plan -lock=false`
locally with it (and the read-only R2 keys): the plan must succeed and match
a plan made with the write token.

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

- **Plan output posted publicly is redacted at the source.** `infra-plan.yml`
  scrubs email addresses from `plan.txt` right after generation (PR comments,
  drift logs, and drift issues all read that file). The repo is public — never
  remove that `sed`.
- **Project recreation drops custom domains AND their DNS record** (Pages
  auto-deletes the zone CNAME when the project is destroyed, 2026-09 live
  lesson). Both `cloudflare_pages_domain` resources and the docs CNAME are
  now terraform-managed, and both Pages projects carry
  `prevent_destroy = true`, so a plan that would destroy one fails instead.
  To recreate one on purpose, drop `prevent_destroy` in the same PR, then
  after `terraform apply -replace` re-check the domain attach and CNAME,
  dispatch the site deploy, and restore `prevent_destroy`. Also: Pages
  refuses to delete a project with too many deployments — prune them via the
  API first (`accounts/.../pages/projects/<p>/deployments`).
- **Provider upgrades past 5.16 are blocked**: 5.24+ cannot read this state's
  `email_routing_settings` (new `support_subaddress` field vs old state objects).
  To upgrade: `terraform state rm` the four email-routing resources, re-import
  them with the new provider, then bump the lock.
- **The router gets the Pages hostnames from Terraform.** `worker/src/index.js`
  reads `LANDING_HOST` / `DOCS_HOST` (plain-text bindings set from the Pages
  projects' `subdomain`); nightly prefixes `nightly.`. It answers 500 rather
  than guess if they are missing, and rewrites any redirect naming a
  `*.pages.dev` host back onto the public origin.
- **HTTPS and security headers.** `always_use_https` is on for the zone, and
  the router redirects `http://` and `www.` itself, then adds HSTS
  (`max-age=31536000; includeSubDomains`), `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, framing rules and a CSP to everything it serves. The
  docs CSP is **report-only** apart from `frame-ancestors`, `object-src` and
  `base-uri`: the tutorial loads Pyodide from jsDelivr, runs WebAssembly and
  blob: workers, and installs from PyPI. Walk through the tutorial with the
  console open; once it reports nothing, move the report-only policy to the
  enforced header in the Worker. `docs.pywire.dev` is served by Pages
  directly and gets none of these headers.
- **`www.pywire.dev` DNS is not in Terraform.** Its proxied record predates
  this config; the `www` Worker route makes the router redirect it to the
  apex. To manage the record here, look up its id
  (`GET /zones/{zone_id}/dns_records?name=www.pywire.dev`), add a
  `cloudflare_dns_record "www"` matching it plus an `import` block with id
  `<zone_id>/<record_id>`, and plan.
