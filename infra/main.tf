terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

variable "account_id" {
  type = string
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

# Add this block!
variable "zone_id" {
  type = string
}

# --- 1. The Documentation Site (Project A) ---
# Connects to the 'pywire/pywire' repo
resource "cloudflare_pages_project" "docs" {
  account_id        = var.account_id
  name              = "pywire-docs"
  production_branch = "main"

  source = {
    type = "github"
    config = {
      owner                         = "pywire"
      repo_name                     = "pywire"
      production_deployment_enabled = true
      pr_comments_enabled           = true
    }
  }

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

  source = {
    type = "github"
    config = {
      owner                         = "pywire"
      repo_name                     = "pywire.dev"
      production_deployment_enabled = true
    }
  }

  build_config = {
    root_dir        = "site"
    build_command   = "pnpm run build"
    destination_dir = "dist"
  }
}

# --- 3. The Router (Worker) ---
resource "cloudflare_workers_script" "router" {
  account_id     = var.account_id
  script_name    = "pywire-router"
  content_file   = "../worker/src/index.js"
  content_sha256 = filesha256("../worker/src/index.js")
  main_module    = "index.js"
}

# --- 4. The DNS & Routing ---
resource "cloudflare_workers_route" "catch_all" {
  zone_id     = var.zone_id
  pattern     = "pywire.dev/*"
  script      = cloudflare_workers_script.router.script_name
}
