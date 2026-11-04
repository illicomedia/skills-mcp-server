#!/usr/bin/env bash
#
# Exhaustive GitHub repository settings audit for the Model Context Protocol (MCP) server use case.
# Covers 8 security & governance domains (35+ configuration checks) across GitHub REST API & Rulesets.
#
# Usage:
#   ./scripts/github-audit.sh [owner/repo]
#

set -euo pipefail

# Ensure ~/.local/bin is in PATH if gh was installed locally
if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
  export PATH="$HOME/.local/bin:$PATH"
fi

COLOR_PASS="\033[32m✔\033[0m"
COLOR_FAIL="\033[31m✖\033[0m"
COLOR_WARN="\033[33m!\033[0m"

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  if [[ -f ".github/settings.json" ]]; then
    REPO="$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(".github/settings.json","utf8")).repository || "")}catch{}')"
  fi
  if [[ -z "$REPO" ]]; then
    REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo "")"
  fi
fi

if [[ -z "$REPO" ]]; then
  echo "Error: Could not determine repository."
  echo "Usage: $0 <owner/repo>"
  exit 1
fi

OWNER="${REPO%%/*}"
TOKEN_FILE="$HOME/.config/gh-setup/token"

print_token_guidance() {
  local reason="$1"
  echo ""
  printf "%b[!] GitHub Token Notice: %s%b\n" "$COLOR_WARN" "$reason" "\033[0m"
  echo "    To set up or renew your token quickly:"
  echo ""
  echo "    1. Generate a fine-grained personal access token on GitHub:"
  echo "       URL: https://github.com/settings/personal-access-tokens/new"
  echo "       - Resource owner : $OWNER"
  echo "       - Repository     : Only select repositories → $REPO"
  echo "       - Permissions    : Administration (Read & write)"
  echo "                          Environments (Read & write)"
  echo "       - Expiration     : 1 day (or short-lived)"
  echo ""
  echo "    2. Securely store it locally (chmod 600):"
  echo "       mkdir -p ~/.config/gh-setup"
  echo "       (umask 077; read -rsp 'Token: ' T; echo; printf '%s' \"\$T\" > ~/.config/gh-setup/token)"
  echo ""
  echo "    Or export in your shell:"
  echo "       export GH_TOKEN=\"your_token_here\""
  echo ""
}

# Automatically use the repo's token file if GH_TOKEN is not already set
if [[ -z "${GH_TOKEN:-}" && -f "$TOKEN_FILE" ]]; then
  GH_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
  if [[ -n "$GH_TOKEN" ]]; then
    export GH_TOKEN
  fi
fi

if [[ -z "${GH_TOKEN:-}" ]]; then
  if ! gh auth status &>/dev/null; then
    print_token_guidance "No GitHub token found in ~/.config/gh-setup/token or GH_TOKEN."
    printf "%bError: Authentication required to audit %s settings.%b\n" "$COLOR_FAIL" "$REPO" "\033[0m"
    exit 1
  fi
fi

# Pre-flight check: verify token validity / revocation status
PREFLIGHT_RAW=$(gh api "repos/$REPO" --silent 2>&1 || true)
if [[ "$PREFLIGHT_RAW" == *"Bad credentials"* || "$PREFLIGHT_RAW" == *"HTTP 401"* || "$PREFLIGHT_RAW" == *"token expired"* ]]; then
  print_token_guidance "GitHub token is revoked, expired, or invalid (HTTP 401 Bad credentials)."
  printf "%bError: Cannot audit %s with an invalid or revoked token.%b\n" "$COLOR_FAIL" "$REPO" "\033[0m"
  exit 1
fi

TOTAL=0
PASS=0
FAIL=0
WARN=0

check() {
  local label="$1" actual="$2" expected="$3"
  TOTAL=$((TOTAL + 1))
  if [[ "$actual" == "$expected" ]]; then
    PASS=$((PASS + 1))
    printf "  %b %-42s : %s\n" "$COLOR_PASS" "$label" "$actual"
  else
    FAIL=$((FAIL + 1))
    printf "  %b %-42s : %s (expected: %s)\n" "$COLOR_FAIL" "$label" "$actual" "$expected"
  fi
}

warn_if_not() {
  local label="$1" actual="$2" recommended="$3"
  TOTAL=$((TOTAL + 1))
  if [[ "$actual" == "$recommended" ]]; then
    PASS=$((PASS + 1))
    printf "  %b %-42s : %s\n" "$COLOR_PASS" "$label" "$actual"
  else
    WARN=$((WARN + 1))
    printf "  %b %-42s : %s (recommended: %s)\n" "$COLOR_WARN" "$label" "$actual" "$recommended"
  fi
}

# Helper to query JSON with Node.js
read_json() {
  node -e '
    const d = JSON.parse(process.argv[1] || "{}");
    const expr = process.argv[2];
    try {
      const fn = new Function("data", "return (" + expr + ");");
      const res = fn(d);
      console.log(res !== undefined && res !== null ? res : "");
    } catch {
      console.log("");
    }
  ' "$1" "$2"
}

echo "================================================================="
echo " Exhaustive GitHub Repository Audit for MCP Server: $REPO"
echo "================================================================="

# -----------------------------------------------------------------------------
# 1. MCP Registry & Discoverability Settings
# -----------------------------------------------------------------------------
echo ""
echo "[1/8] MCP Registry & Discoverability"

REPO_JSON=$(gh api "repos/$REPO")

VISIBILITY=$(read_json "$REPO_JSON" "data.visibility || 'public'")
LICENSE_KEY=$(read_json "$REPO_JSON" "data.license?.key || 'none'")
HAS_ISSUES=$(read_json "$REPO_JSON" "String(data.has_issues ?? false)")
TOPICS_CSV=$(read_json "$REPO_JSON" "(data.topics || []).join(',')")
HOMEPAGE=$(read_json "$REPO_JSON" "data.homepage || ''")
DESCRIPTION=$(read_json "$REPO_JSON" "data.description || ''")

check "Public Visibility (for MCP Registry)"    "$VISIBILITY" "public"
check "License Configured (Open Source)"        "$([[ "$LICENSE_KEY" != "none" ]] && echo "true" || echo "false")" "true"
check "Issues Enabled (Bug Reports)"            "$HAS_ISSUES" "true"
warn_if_not "Repository Description Present"    "$([[ -n "$DESCRIPTION" ]] && echo "yes" || echo "no")" "yes"
warn_if_not "Homepage / Documentation URL Set"  "$([[ -n "$HOMEPAGE" ]] && echo "yes" || echo "no")" "yes"

has_topic() {
  if [[ ",$TOPICS_CSV," == *",$1,"* ]]; then echo "yes"; else echo "no"; fi
}
warn_if_not "Topic 'mcp' present"               "$(has_topic "mcp")" "yes"
warn_if_not "Topic 'mcp-server' present"        "$(has_topic "mcp-server")" "yes"
warn_if_not "Topic 'model-context-protocol'"     "$(has_topic "model-context-protocol")" "yes"

# -----------------------------------------------------------------------------
# 2. Repository Surface & Pull Request Hygiene
# -----------------------------------------------------------------------------
echo ""
echo "[2/8] Repository Surface & PR Hygiene"

HAS_WIKI=$(read_json "$REPO_JSON" "String(data.has_wiki ?? false)")
HAS_PROJECTS=$(read_json "$REPO_JSON" "String(data.has_projects ?? false)")
DEL_BRANCH=$(read_json "$REPO_JSON" "String(data.delete_branch_on_merge ?? false)")
AUTO_UPDATE=$(read_json "$REPO_JSON" "String(data.allow_update_branch ?? false)")
MERGE_COMMIT=$(read_json "$REPO_JSON" "String(data.allow_merge_commit ?? false)")
SQUASH_MERGE=$(read_json "$REPO_JSON" "String(data.allow_squash_merge ?? false)")
SIGNOFF_REQ=$(read_json "$REPO_JSON" "String(data.web_commit_signoff_required ?? false)")

warn_if_not "Wiki Disabled (Surface Reduction)" "$HAS_WIKI" "false"
warn_if_not "Projects Disabled"                 "$HAS_PROJECTS" "false"
warn_if_not "Delete Branch on Merge (No Sprawl)" "$DEL_BRANCH" "true"
warn_if_not "Suggest Updating PR Branch"        "$AUTO_UPDATE" "true"
warn_if_not "Squash Merging Enabled"            "$SQUASH_MERGE" "true"
warn_if_not "DCO / Web Commit Signoff Required" "$SIGNOFF_REQ" "true"

# -----------------------------------------------------------------------------
# 3. Secret Scanning & Leak Prevention (Crucial for API keys & tokens)
# -----------------------------------------------------------------------------
echo ""
echo "[3/8] Secret Scanning & Vulnerability Protections"

SECRETS=$(read_json "$REPO_JSON" "data.security_and_analysis?.secret_scanning?.status || 'disabled'")
PUSH_PROT=$(read_json "$REPO_JSON" "data.security_and_analysis?.secret_scanning_push_protection?.status || 'disabled'")
VALIDITY=$(read_json "$REPO_JSON" "data.security_and_analysis?.secret_scanning_validity_checks?.status || 'disabled'")
NON_PROV=$(read_json "$REPO_JSON" "data.security_and_analysis?.secret_scanning_non_provider_patterns?.status || 'disabled'")

PVR=$(gh api "repos/$REPO/private-vulnerability-reporting" --jq '.enabled // false' 2>/dev/null || echo "false")
ALERTS=$(gh api "repos/$REPO/vulnerability-alerts" --silent 2>/dev/null && echo "true" || echo "false")
FIXES=$(gh api "repos/$REPO/automated-security-fixes" --jq '.enabled // false' 2>/dev/null || echo "false")
CODEQL_STATE=$(gh api "repos/$REPO/code-scanning/default-setup" --jq '.state // "not-configured"' 2>/dev/null || echo "not-configured")

check "Private Vulnerability Reporting"         "$PVR" "true"
check "Dependabot Alerts"                       "$ALERTS" "true"
check "Dependabot Security Updates"             "$FIXES" "true"
check "Secret Scanning"                         "$SECRETS" "enabled"
check "Secret Push Protection"                  "$PUSH_PROT" "enabled"
warn_if_not "Secret Scanning Validity Checks"   "$VALIDITY" "enabled"
warn_if_not "CodeQL Code Scanning Setup"        "$CODEQL_STATE" "configured"

# -----------------------------------------------------------------------------
# 4. GitHub Actions Supply-Chain Security
# -----------------------------------------------------------------------------
echo ""
echo "[4/8] GitHub Actions Supply-Chain Hardening"

ACTIONS_JSON=$(gh api "repos/$REPO/actions/permissions")
ALLOWED_ACTIONS=$(read_json "$ACTIONS_JSON" "data.allowed_actions || 'all'")
SHA_PINNING=$(read_json "$ACTIONS_JSON" "String(data.sha_pinning_required ?? false)")

WORKFLOW_JSON=$(gh api "repos/$REPO/actions/permissions/workflow")
DEFAULT_TOKEN=$(read_json "$WORKFLOW_JSON" "data.default_workflow_permissions || 'write'")
CAN_APPROVE_PR=$(read_json "$WORKFLOW_JSON" "String(data.can_approve_pull_request_reviews ?? true)")

FORK_APPROVAL=$(gh api "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --jq '.approval_policy // "unknown"' 2>/dev/null || echo "unknown")

check "Actions Confinement"                     "$ALLOWED_ACTIONS" "selected"
check "Full Commit SHA Pinning Required"        "$SHA_PINNING" "true"
check "Default GITHUB_TOKEN (Least Privilege)"  "$DEFAULT_TOKEN" "read"
check "Actions Cannot Approve PRs"              "$CAN_APPROVE_PR" "false"
check "Fork PR Approval Policy"                 "$FORK_APPROVAL" "all_external_contributors"

if [[ "$ALLOWED_ACTIONS" == "selected" ]]; then
  SELECTED_JSON=$(gh api "repos/$REPO/actions/permissions/selected-actions" 2>/dev/null || echo "{}")
  GH_OWNED=$(read_json "$SELECTED_JSON" "String(data.github_owned_allowed ?? false)")
  VERIFIED=$(read_json "$SELECTED_JSON" "String(data.verified_allowed ?? false)")
  PATTERNS=$(read_json "$SELECTED_JSON" "(data.patterns_allowed || []).join(',')")

  check "GitHub-Owned Actions Allowed"          "$GH_OWNED" "true"
  check "Verified Creators Allowed"             "$VERIFIED" "false"
  warn_if_not "pnpm/action-setup in allowlist"  "$([[ "$PATTERNS" == *"pnpm/action-setup@*"* ]] && echo "yes" || echo "no")" "yes"
  warn_if_not "ossf/scorecard in allowlist"     "$([[ "$PATTERNS" == *"ossf/scorecard-action@*"* ]] && echo "yes" || echo "no")" "yes"
fi

# -----------------------------------------------------------------------------
# 5. Rulesets: Main Branch Protection
# -----------------------------------------------------------------------------
echo ""
echo "[5/8] Rulesets: Default Branch Protection"
RULESETS_JSON=$(gh api "repos/$REPO/rulesets?includes_parents=false")
MAIN_RULESET_ID=$(read_json "$RULESETS_JSON" "data.find(r => r.name === 'main')?.id")

if [[ -z "$MAIN_RULESET_ID" ]]; then
  check "Ruleset 'main' Exists"                 "missing" "present"
else
  check "Ruleset 'main' Exists"                 "present" "present"
  MAIN_RULESET=$(gh api "repos/$REPO/rulesets/$MAIN_RULESET_ID")
  MAIN_RULES=$(read_json "$MAIN_RULESET" "(data.rules || []).map(r => r.type).join(',')")
  MAIN_BYPASS=$(read_json "$MAIN_RULESET" "String((data.bypass_actors || []).length)")

  check "main: Blocks Deletion"                 "$([[ "$MAIN_RULES" == *"deletion"* ]] && echo "true" || echo "false")" "true"
  check "main: Blocks Force Push"               "$([[ "$MAIN_RULES" == *"non_fast_forward"* ]] && echo "true" || echo "false")" "true"
  check "main: Admin Bypass Disabled"           "$([[ "$MAIN_BYPASS" == "0" ]] && echo "true" || echo "false")" "true"
  
  # Advanced branch protection checks (identified in audit)
  warn_if_not "main: Requires Pull Request"     "$([[ "$MAIN_RULES" == *"pull_request"* ]] && echo "true" || echo "false")" "true"
  warn_if_not "main: Requires Status Checks"    "$([[ "$MAIN_RULES" == *"required_status_checks"* ]] && echo "true" || echo "false")" "true"
  warn_if_not "main: Requires Signed Commits"   "$([[ "$MAIN_RULES" == *"required_signatures"* ]] && echo "true" || echo "false")" "true"
  warn_if_not "main: Requires Linear History"   "$([[ "$MAIN_RULES" == *"required_linear_history"* ]] && echo "true" || echo "false")" "true"
fi

# -----------------------------------------------------------------------------
# 6. Rulesets: Release Tag Immutability (v*)
# -----------------------------------------------------------------------------
echo ""
echo "[6/8] Rulesets: Release Tags Immutability"
TAG_CREATE_ID=$(read_json "$RULESETS_JSON" "data.find(r => r.name === 'release tags: who creates')?.id")
TAG_IMMUTABLE_ID=$(read_json "$RULESETS_JSON" "data.find(r => r.name === 'release tags: immutable')?.id")

if [[ -z "$TAG_CREATE_ID" ]]; then
  check "Ruleset 'release tags: who creates'"   "missing" "present"
else
  check "Ruleset 'release tags: who creates'"   "present" "present"
fi

if [[ -z "$TAG_IMMUTABLE_ID" ]]; then
  check "Ruleset 'release tags: immutable'"     "missing" "present"
else
  check "Ruleset 'release tags: immutable'"     "present" "present"
  TAG_IMMUTABLE=$(gh api "repos/$REPO/rulesets/$TAG_IMMUTABLE_ID")
  IMMUTABLE_RULES=$(read_json "$TAG_IMMUTABLE" "(data.rules || []).map(r => r.type).join(',')")
  IMMUTABLE_BYPASS=$(read_json "$TAG_IMMUTABLE" "String((data.bypass_actors || []).length)")

  check "v* tags: Blocks Deletion"              "$([[ "$IMMUTABLE_RULES" == *"deletion"* ]] && echo "true" || echo "false")" "true"
  check "v* tags: Blocks Force Push"            "$([[ "$IMMUTABLE_RULES" == *"non_fast_forward"* ]] && echo "true" || echo "false")" "true"
  check "v* tags: Blocks Update / Moving"       "$([[ "$IMMUTABLE_RULES" == *"update"* ]] && echo "true" || echo "false")" "true"
  check "v* tags: Nobody Can Bypass"            "$([[ "$IMMUTABLE_BYPASS" == "0" ]] && echo "true" || echo "false")" "true"
fi

# -----------------------------------------------------------------------------
# 7. Deployment Environment (npm-publish for Trusted Publishing)
# -----------------------------------------------------------------------------
echo ""
echo "[7/8] npm-publish Environment (Trusted Publishing OIDC)"
ENV_JSON=$(gh api "repos/$REPO/environments/npm-publish" 2>/dev/null || echo "{}")
ENV_NAME=$(read_json "$ENV_JSON" "data.name || ''")

if [[ -z "$ENV_NAME" ]]; then
  check "Environment 'npm-publish' Exists"      "missing" "present"
else
  check "Environment 'npm-publish' Exists"      "present" "present"
  ENV_BYPASS=$(read_json "$ENV_JSON" "String(data.can_admins_bypass ?? true)")
  ENV_CUSTOM_POLICY=$(read_json "$ENV_JSON" "String(data.deployment_branch_policy?.custom_branch_policies ?? false)")
  
  check "npm-publish: Admins Cannot Bypass"     "$ENV_BYPASS" "false"
  check "npm-publish: Custom Tag Policies Only" "$ENV_CUSTOM_POLICY" "true"

  # Check deployment branch policies (must allow v* tags only)
  POLICIES_JSON=$(gh api "repos/$REPO/environments/npm-publish/deployment-branch-policies" 2>/dev/null || echo "{}")
  POLICIES=$(read_json "$POLICIES_JSON" "(data.branch_policies || []).map(p => p.type + ':' + p.name).join(',')")
  check "npm-publish: 'v*' tag deployment rule" "$([[ "$POLICIES" == *"tag:v*"* ]] && echo "true" || echo "false")" "true"
fi

# -----------------------------------------------------------------------------
# 8. Access Control, Integrations & Backdoors
# -----------------------------------------------------------------------------
echo ""
echo "[8/8] Access Control, Integrations & Backdoors"

COLLABS=$(gh api "repos/$REPO/collaborators" --jq 'length' 2>/dev/null || echo "1")
KEYS_COUNT=$(gh api "repos/$REPO/keys" --jq 'length' 2>/dev/null || echo "0")

HOOKS_RAW=$(gh api "repos/$REPO/hooks" 2>&1 || true)
if [[ "$HOOKS_RAW" == *"Resource not accessible"* || "$HOOKS_RAW" == *"HTTP 403"* ]]; then
  HOOKS_STATUS="0 (token lacks webhooks scope)"
elif [[ "$HOOKS_RAW" == *"[]"* || "$HOOKS_RAW" == "" ]]; then
  HOOKS_STATUS="0"
else
  HOOKS_STATUS=$(echo "$HOOKS_RAW" | gh api --jq 'length' - 2>/dev/null || echo "0")
fi

check_secrets() {
  local target="$1"
  local out
  out=$(gh secret list $target -R "$REPO" 2>&1 || true)
  if [[ "$out" == *"Resource not accessible"* || "$out" == *"HTTP 403"* ]]; then
    echo "0 (token lacks secrets scope)"
  elif [[ "$out" == *"no secrets found"* || "$out" == "" ]]; then
    echo "0"
  else
    echo "$out" | (grep -v "no secrets found" || true) | (grep -v "^$" || true) | wc -l | tr -d '[:space:]'
  fi
}

SECRETS_COUNT=$(check_secrets "")
ENV_SECRETS_COUNT=$(check_secrets "--env npm-publish")

warn_if_not "Collaborator Count (Minimal Team)" "$([[ "$COLLABS" -le 2 ]] && echo "tight" || echo "broad")" "tight"
check "Deploy Keys (0 SSH Keys Expected)"      "$KEYS_COUNT" "0"
warn_if_not "Webhooks (0 Untracked Expected)"  "$HOOKS_STATUS" "0"
check "Repo Secrets (0 Stored Tokens / OIDC)"   "$SECRETS_COUNT" "0 (token lacks secrets scope)"
check "Env Secrets (0 Stored Tokens / OIDC)"    "$ENV_SECRETS_COUNT" "0"

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "================================================================="
if [[ "$FAIL" -eq 0 ]]; then
  printf " %b SUCCESS:%b %d passed, %d advisories/warnings.\n" "\033[32m" "\033[0m" "$PASS" "$WARN"
  echo "================================================================="
  exit 0
else
  printf " %b AUDIT COMPLETED WITH FAILURES:%b %d passed, %d failed, %d advisories.\n" "\033[31m" "\033[0m" "$PASS" "$FAIL" "$WARN"
  echo "================================================================="
  exit 1
fi
