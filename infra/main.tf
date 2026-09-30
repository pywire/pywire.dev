terraform {
  required_version = ">= 1.10" # backend use_lockfile needs native S3 locking

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0" # pinned by .terraform.lock.hcl at 5.16.0 — 5.24+ cannot
      # read this state's email_routing_settings (support_subaddress)
    }
  }

  # Remote state on R2. The pywire-tfstate bucket was created manually (once,
  # chicken-and-egg) — see infra/README.md. Access keys come from the
  # environment (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
  backend "s3" {
    bucket                      = "pywire-tfstate"
    key                         = "pywire.dev.tfstate"
    region                      = "auto"
    endpoints                   = { s3 = "https://abd8226d8d910afcfa1d370097e6336a.r2.cloudflarestorage.com" }
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    use_lockfile                = true
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# --- 1. The Sites (Pages projects) ---
# Both are direct-upload projects: GitHub Actions builds and deploys them
# (pywire/pywire deploy-docs.yml for docs, this repo's deploy.yml for the
# landing site). No Cloudflare-side GitHub integration — that was legacy
# from before the workflows existed, kept disabled until now.
resource "cloudflare_pages_project" "docs" {
  account_id        = var.account_id
  name              = "pywire-docs"
  production_branch = "main"

  # Inert for direct-upload deploys; declared because provider 5.16 errors
  # on plans without it. Its computed sub-attrs (build_caching,
  # web_analytics_*) phantom-diff every plan until the project is recreated
  # (see infra/README.md).
  build_config = {
    root_dir        = "docs"
    build_command   = "pnpm run build"
    destination_dir = "dist"
  }
}

resource "cloudflare_pages_project" "landing" {
  account_id        = var.account_id
  name              = "pywire-landing"
  production_branch = "main"

  build_config = {
    root_dir        = "site"
    build_command   = "pnpm run build"
    destination_dir = "dist"
  }
}

# Custom domains: Pages auto-managed this CNAME while the domain was attached
# to the old project; destroying the project deleted it. Declared here so a
# future project recreate can't silently drop DNS for the docs site.
resource "cloudflare_dns_record" "docs_cname" {
  zone_id = var.zone_id
  name    = "docs"
  content = "pywire-docs.pages.dev"
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

resource "cloudflare_pages_domain" "docs" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.docs.name
  name         = "docs.pywire.dev"
}

resource "cloudflare_pages_domain" "landing" {
  account_id   = var.account_id
  project_name = cloudflare_pages_project.landing.name
  name         = "pywire.dev"
}

# --- 3. CDN Bucket (R2) ---
resource "cloudflare_r2_bucket" "cdn" {
  account_id = var.account_id
  name       = "pywire-cdn"
  location   = "WNAM"
}

# --- 4. The Router (Worker) ---
resource "cloudflare_workers_script" "router" {
  account_id     = var.account_id
  script_name    = "pywire-router"
  content_file   = "../worker/src/index.js"
  content_sha256 = filesha256("../worker/src/index.js")
  main_module    = "index.js"

  bindings = [{
    name        = "CDN_BUCKET"
    type        = "r2_bucket"
    bucket_name = cloudflare_r2_bucket.cdn.name
  }]
}

# --- Nightly Environment ---
# 1. DNS Record
resource "cloudflare_dns_record" "nightly" {
  zone_id = var.zone_id
  name    = "nightly"
  content = cloudflare_pages_project.landing.subdomain
  type    = "CNAME"
  proxied = true
  ttl     = 1
}

# --- Demos (demo.pywire.dev) ---
# The landing page and each example are Workers. Terraform creates them and
# owns their DNS and routes; pywire/pywire's Deploy Examples workflow only
# uploads their code and vars, the way Pages deployments go to the Pages
# projects above. Secrets are set with `wrangler secret put` so they stay out
# of state.
resource "cloudflare_dns_record" "demo" {
  zone_id = var.zone_id
  name    = "demo"
  content = "100::" # Cloudflare's placeholder for a Worker-only hostname
  type    = "AAAA"
  proxied = true
  ttl     = 1
}

locals {
  # Each example is served under /<name> by the Worker pywire-demo-<name>.
  demo_examples = ["edge-stateless", "form-builder"]
  demo_workers = merge(
    { "site" = "pywire-demo" },
    { for name in local.demo_examples : name => "pywire-demo-${name}" },
  )
  demo_routes = merge(
    { "site" = { pattern = "demo.pywire.dev/*", worker = "site" } },
    { for name in local.demo_examples : name => {
      pattern = "demo.pywire.dev/${name}", worker = name
    } },
    { for name in local.demo_examples : "${name}/*" => {
      pattern = "demo.pywire.dev/${name}/*", worker = name
    } },
  )
}

# Created through the scripts API, like the router, with a placeholder that
# answers 503 until the Deploy Examples workflow uploads the real code. After
# that the workflow owns the code and settings, so Terraform never updates
# them. A code-less cloudflare_worker can't take routes ("Cannot configure a
# route for a Worker which does not exist"), so the placeholder is what lets
# the routes apply before the first deploy.
resource "cloudflare_workers_script" "demo" {
  for_each           = local.demo_workers
  account_id         = var.account_id
  script_name        = each.value
  main_module        = "placeholder.js"
  compatibility_date = "2026-09-01"
  content            = <<-JS
    export default {
      fetch() {
        return new Response("This demo hasn't been deployed yet.", { status: 503 });
      },
    };
  JS

  lifecycle {
    ignore_changes = all
  }
}

# The first apply created these as code-less cloudflare_worker resources.
# Forget them without deleting; the scripts above upload to the same names.
removed {
  from = cloudflare_worker.demo

  lifecycle {
    destroy = false
  }
}

# Cloudflare sends a request to the most specific matching route, so the
# example routes win over the landing page's catch-all.
resource "cloudflare_workers_route" "demo" {
  for_each = local.demo_routes
  zone_id  = var.zone_id
  pattern  = each.value.pattern
  script   = cloudflare_workers_script.demo[each.value.worker].script_name
}

# --- VS Code Marketplace Domain Verification ---
resource "cloudflare_dns_record" "vscode_verification" {
  zone_id = var.zone_id
  name    = "_visual-studio-marketplace-pywire"
  content = var.vscode_marketplace_verification_code
  type    = "TXT"
  ttl     = 3600
}




# --- 5. The DNS & Routing ---
resource "cloudflare_workers_route" "catch_all" {
  zone_id = var.zone_id
  pattern = "pywire.dev/*"
  script  = cloudflare_workers_script.router.script_name
}

resource "cloudflare_workers_route" "nightly" {
  zone_id = var.zone_id
  pattern = "nightly.pywire.dev/*"
  script  = cloudflare_workers_script.router.script_name
}

# --- 6. Allow AI crawlers to LLM documentation files ---
resource "cloudflare_ruleset" "allow_llm_crawlers" {
  zone_id     = var.zone_id
  name        = "Allow AI crawlers to LLM txt files"
  description = "Bypass WAF and bot checks for AI fetch bots accessing LLM documentation files"
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules = [{
    action = "skip"
    action_parameters = {
      ruleset = "current"
    }
    expression  = "(http.request.uri.path in {\"/llms.txt\" \"/llms-short.txt\" \"/llms-full.txt\"})"
    description = "Allow AI crawlers to access LLM documentation files"
    enabled     = true
  }]
}

# --- 7. Email Routing Setup ---

resource "cloudflare_email_routing_settings" "main" {
  zone_id = var.zone_id
}



# Destination Registration
# Helper to find every unique email address across both variables
locals {
  all_unique_emails = distinct(concat(
    values(var.forwarding_rules),
    var.maintainer_emails
  ))
}

# Register every email found in your variables
resource "cloudflare_email_routing_address" "destinations" {
  for_each   = toset(local.all_unique_emails)
  account_id = var.account_id
  email      = each.value
}

# Individual Rules
resource "cloudflare_email_routing_rule" "individual_aliases" {
  for_each = var.forwarding_rules

  zone_id = var.zone_id
  name    = "Forward: ${each.key}@"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "${each.key}@pywire.dev"
  }]

  actions = [{
    type = "forward"
    # Look up the verified address resource
    value = [cloudflare_email_routing_address.destinations[each.value].email]
  }]
}

# The Maintainers Group Rule
resource "cloudflare_email_routing_rule" "maintainers_group" {
  zone_id = var.zone_id
  name    = "Group: Maintainers"
  enabled = true

  matchers = [{
    type  = "literal"
    field = "to"
    value = "maintainers@pywire.dev"
  }]

  actions = [{
    type = "forward"
    # Dynamically grab the verified email ID for everyone in the list
    value = [
      for email in var.maintainer_emails :
      cloudflare_email_routing_address.destinations[email].email
    ]
  }]
}
