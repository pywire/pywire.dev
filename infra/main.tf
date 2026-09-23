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
