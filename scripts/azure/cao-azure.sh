#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$ROOT/.cao/azure"
PACKAGE_DIR="$BUILD_DIR/package"
PACKAGE_ZIP="$BUILD_DIR/cao-functions.zip"
PROXY_REGISTRY="https://packagefeedproxy.microsoft.io/npm/"

usage() {
  cat <<'EOF'
Usage: scripts/azure/cao-azure.sh COMMAND CONFIG [ARG]

Commands:
  preflight CONFIG              Check local tools, Azure login, subscription, and names.
  bootstrap CONFIG              Create the resource group and Key Vault, then load secrets.
  validate CONFIG               Run ARM validation and what-if without changing resources.
  infrastructure CONFIG         Deploy the private Azure application infrastructure.
  package CONFIG                Build the deterministic Azure Functions zip package.
  publish CONFIG                Zip-deploy the package to the Function App.
  ingest CONFIG ARTIFACT_DIR    Upload a verified dashboard artifact and run private ingestion.
  verify CONFIG                 Check health, readiness, and the OAuth redirect.
  deploy CONFIG ARTIFACT_DIR    Validate, deploy, package, publish, ingest, and verify.
  destroy CONFIG --yes          Delete the resource group and purge a disposable Key Vault.

CONFIG is a JSON file shaped like server/azure/config.example.json. It contains
resource names and authorization policy, but never secrets.
EOF
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

config_value() {
  local query="$1"
  jq -er "$query" "$CONFIG"
}

load_config() {
  CONFIG="${1:-}"
  [[ -n "$CONFIG" ]] || fail "a configuration JSON file is required"
  [[ -f "$CONFIG" ]] || fail "configuration file not found: $CONFIG"
  CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

  SUBSCRIPTION_ID="$(config_value '.subscriptionId | select(type == "string" and length > 0)')"
  LOCATION="$(config_value '.location | select(type == "string" and length > 0)')"
  RESOURCE_GROUP="$(config_value '.resourceGroup | select(type == "string" and length > 0)')"
  FUNCTION_APP_NAME="$(config_value '.functionAppName | select(type == "string" and length > 0)')"
  STORAGE_ACCOUNT_NAME="$(config_value '.storageAccountName | select(type == "string" and length > 0)')"
  KEY_VAULT_NAME="$(config_value '.keyVaultName | select(type == "string" and length > 0)')"
  REDIS_NAME="$(config_value '.redisEnterpriseName | select(type == "string" and length > 0)')"
  POSTGRES_NAME="$(config_value '.postgresServerName | select(type == "string" and length > 0)')"
  GITHUB_CLIENT_ID="$(config_value '.githubClientId | select(type == "string" and length > 0)')"
  ALLOWED_ORGS="$(config_value '.githubAllowedOrganizations | select(type == "array") | @json')"
  ALLOWED_TEAMS="$(config_value '.githubAllowedTeams | select(type == "array") | @json')"
  INGESTION_IMAGE="$(config_value '.ingestionImage | select(type == "string" and length > 0)')"
  PURGE_PROTECTION="$(
    jq -er 'if has("enablePurgeProtection") then .enablePurgeProtection else true end | select(type == "boolean")' "$CONFIG"
  )"
  ALLOWED_HOSTS="[\"${FUNCTION_APP_NAME}.azurewebsites.net\"]"
}

select_subscription() {
  az account set --subscription "$SUBSCRIPTION_ID"
  local selected
  selected="$(az account show --query id -o tsv)"
  [[ "$selected" == "$SUBSCRIPTION_ID" ]] || fail "Azure CLI selected unexpected subscription $selected"
}

preflight() {
  local command
  for command in az curl go jq node npm openssl zip; do
    require_command "$command"
  done
  az account show --output none
  select_subscription
  az bicep version
  az containerapp job --help >/dev/null

  local namespace state
  for namespace in \
    Microsoft.App \
    Microsoft.Cache \
    Microsoft.DBforPostgreSQL \
    Microsoft.Insights \
    Microsoft.KeyVault \
    Microsoft.ManagedIdentity \
    Microsoft.Network \
    Microsoft.Storage \
    Microsoft.Web; do
    state="$(az provider show --namespace "$namespace" --query registrationState -o tsv)"
    case "$state" in
      Registered) ;;
      Registering)
        printf 'warning: Azure resource provider registration is still converging: %s\n' "$namespace" >&2
        ;;
      *) fail "Azure resource provider is not registered: $namespace" ;;
    esac
  done

  [[ "$STORAGE_ACCOUNT_NAME" =~ ^[a-z0-9]{3,24}$ ]] ||
    fail "storageAccountName must be 3-24 lowercase letters and digits"
  [[ "$GITHUB_CLIENT_ID" != YOUR_* ]] || fail "replace the GitHub OAuth client ID placeholder"
  [[ "$INGESTION_IMAGE" != *YOUR_TRUSTED_COMMIT_SHA* ]] ||
    fail "pin ingestionImage to a published immutable CAO commit image"
  [[ "$(jq '(.githubAllowedOrganizations | length) + (.githubAllowedTeams | length)' "$CONFIG")" -gt 0 ]] ||
    fail "configure at least one allowed GitHub organization or team"

  printf 'Subscription: %s\nResource group: %s\nRegion: %s\nOAuth callback: https://%s.azurewebsites.net/auth/callback\n' \
    "$SUBSCRIPTION_ID" "$RESOURCE_GROUP" "$LOCATION" "$FUNCTION_APP_NAME"
}

wait_for_vault_access() {
  local remaining=18
  while ((remaining > 0)); do
    if az keyvault secret list --vault-name "$KEY_VAULT_NAME" --maxresults 1 --output none 2>/dev/null; then
      return
    fi
    remaining=$((remaining - 1))
    sleep 10
  done
  fail "Key Vault role assignment did not become usable after three minutes"
}

set_secret_file() {
  local name="$1"
  local file="$2"
  az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "$name" \
    --file "$file" \
    --output none
}

secret_exists() {
  az keyvault secret show \
    --vault-name "$KEY_VAULT_NAME" \
    --name "$1" \
    --query attributes.enabled \
    -o tsv 2>/dev/null | grep -qx true
}

bootstrap() {
  preflight
  az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

  local deployer_object_id
  deployer_object_id="$(az ad signed-in-user show --query id -o tsv)"
  az deployment group create \
    --name cao-bootstrap \
    --resource-group "$RESOURCE_GROUP" \
    --template-file "$ROOT/server/azure/bootstrap.bicep" \
    --parameters \
      location="$LOCATION" \
      keyVaultName="$KEY_VAULT_NAME" \
      deployerObjectId="$deployer_object_id" \
      enablePurgeProtection="$PURGE_PROTECTION" \
    --output none
  wait_for_vault_access

  local secret_dir oauth_file session_file postgres_file
  secret_dir="$(mktemp -d)"
  trap 'rm -rf "$secret_dir"' EXIT
  oauth_file="$secret_dir/oauth"
  session_file="$secret_dir/session"
  postgres_file="$secret_dir/postgres"
  chmod 700 "$secret_dir"

  if ! secret_exists github-oauth-client-secret; then
    printf 'GitHub OAuth client secret: ' >&2
    IFS= read -r -s oauth_secret
    printf '\n' >&2
    [[ -n "$oauth_secret" ]] || fail "the GitHub OAuth client secret cannot be empty"
    printf '%s' "$oauth_secret" >"$oauth_file"
    unset oauth_secret
    chmod 600 "$oauth_file"
    set_secret_file github-oauth-client-secret "$oauth_file"
  fi
  if ! secret_exists cao-session-secret; then
    openssl rand -base64 48 | tr -d '\n' >"$session_file"
    chmod 600 "$session_file"
    set_secret_file cao-session-secret "$session_file"
  fi
  if ! secret_exists cao-postgres-admin-password; then
    openssl rand -hex 32 | tr -d '\n' >"$postgres_file"
    chmod 600 "$postgres_file"
    set_secret_file cao-postgres-admin-password "$postgres_file"
  fi
  rm -rf "$secret_dir"
  trap - EXIT
  printf 'Bootstrap complete. Secrets were written directly to %s.\n' "$KEY_VAULT_NAME"
}

require_bootstrap_secrets() {
  local name
  for name in github-oauth-client-secret cao-session-secret cao-postgres-admin-password; do
    az keyvault secret show \
      --vault-name "$KEY_VAULT_NAME" \
      --name "$name" \
      --query attributes.enabled \
      -o tsv | grep -qx true || fail "required Key Vault secret is unavailable: $name"
  done
}

main_deployment_args=()
build_main_deployment_args() {
  main_deployment_args=(
    --resource-group "$RESOURCE_GROUP"
    --template-file "$ROOT/server/azure/main.bicep"
    --parameters
    location="$LOCATION"
    functionAppName="$FUNCTION_APP_NAME"
    storageAccountName="$STORAGE_ACCOUNT_NAME"
    keyVaultName="$KEY_VAULT_NAME"
    redisEnterpriseName="$REDIS_NAME"
    postgresServerName="$POSTGRES_NAME"
    allowedHosts="$ALLOWED_HOSTS"
    githubAllowedOrganizations="$ALLOWED_ORGS"
    githubAllowedTeams="$ALLOWED_TEAMS"
    githubClientId="$GITHUB_CLIENT_ID"
    ingestionImage="$INGESTION_IMAGE"
  )
}

validate() {
  preflight
  require_bootstrap_secrets
  build_main_deployment_args
  az deployment group validate \
    --name cao-main-validate \
    "${main_deployment_args[@]}" \
    --output none
  az deployment group what-if \
    --name cao-main-what-if \
    "${main_deployment_args[@]}"
}

infrastructure() {
  preflight
  require_bootstrap_secrets
  build_main_deployment_args
  local attempt
  for attempt in 1 2 3; do
    if az deployment group create \
      --name cao-main \
      "${main_deployment_args[@]}" \
      --output none; then
      return
    fi
    [[ "$attempt" -lt 3 ]] || fail "main deployment failed after three attempts"
    printf 'warning: main deployment attempt %s failed; retrying after identity propagation delay\n' \
      "$attempt" >&2
    sleep 30
  done
}

package_functions() {
  preflight
  [[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=all)" ]] ||
    fail "package builds require a clean Git worktree for trustworthy revision provenance"
  mkdir -p "$BUILD_DIR"
  rm -rf "$PACKAGE_DIR"
  mkdir -p \
    "$PACKAGE_DIR/site" \
    "$PACKAGE_DIR/queries" \
    "$PACKAGE_DIR/.github/workflows" \
    "$PACKAGE_DIR/cao"

  local npm_registry npm_proxy npm_https_proxy clear_local_proxy=false
  npm_registry="$(npm config get registry)"
  npm_proxy="$(npm config get proxy)"
  npm_https_proxy="$(npm config get https-proxy)"
  if [[ "$npm_proxy" =~ ^https?://(localhost|127\.0\.0\.1): ]] &&
    ! curl --silent --show-error --max-time 2 --proxy "$npm_proxy" "$PROXY_REGISTRY" >/dev/null 2>&1; then
    clear_local_proxy=true
    npm config delete proxy
    npm config delete https-proxy
  fi

  npm config set registry "$PROXY_REGISTRY"
  if ! npm --prefix "$ROOT/dashboard/site" ci --no-audit --no-fund; then
    npm config set registry "$npm_registry"
    if [[ "$clear_local_proxy" == true ]]; then
      [[ "$npm_proxy" == null ]] || npm config set proxy "$npm_proxy"
      [[ "$npm_https_proxy" == null ]] || npm config set https-proxy "$npm_https_proxy"
    fi
    return 1
  fi
  npm config set registry "$npm_registry"
  if [[ "$clear_local_proxy" == true ]]; then
    [[ "$npm_proxy" == null ]] || npm config set proxy "$npm_proxy"
    [[ "$npm_https_proxy" == null ]] || npm config set https-proxy "$npm_https_proxy"
  fi
  local revision
  revision="$(git -C "$ROOT" rev-parse HEAD)"
  npm --prefix "$ROOT/dashboard/site" run build -- \
    dist ../../.github/workflows/cao.azure.json "$revision"

  GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go -C "$ROOT/server" build -trimpath -o "$PACKAGE_DIR/cao-functions" ./cmd/cao-functions
  cp -R "$ROOT/dashboard/site/dist/." "$PACKAGE_DIR/site/"
  cp "$ROOT/dashboard/site/src/data/queries/database.json" "$PACKAGE_DIR/queries/database.json"
  cp "$ROOT/.github/workflows/cao.json" "$PACKAGE_DIR/.github/workflows/cao.json"
  cp "$ROOT/.github/workflows/cao.azure.json" "$PACKAGE_DIR/.github/workflows/cao.azure.json"

  cat >"$PACKAGE_DIR/host.json" <<'JSON'
{
  "version": "2.0",
  "customHandler": {
    "description": {
      "defaultExecutablePath": "cao-functions"
    },
    "enableForwardingHttpRequest": true
  },
  "extensions": {
    "http": {
      "routePrefix": ""
    }
  }
}
JSON

  cat >"$PACKAGE_DIR/cao/function.json" <<'JSON'
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "direction": "in",
      "methods": ["delete", "get", "head", "options", "patch", "post", "put"],
      "name": "request",
      "route": "{*path}",
      "type": "httpTrigger"
    },
    {
      "direction": "out",
      "name": "$return",
      "type": "http"
    }
  ]
}
JSON

  rm -f "$PACKAGE_ZIP"
  (
    cd "$PACKAGE_DIR"
    zip -qr "$PACKAGE_ZIP" .
  )
  printf 'Created %s\n' "$PACKAGE_ZIP"
}

publish() {
  preflight
  [[ -f "$PACKAGE_ZIP" ]] || fail "package not found; run the package command first"
  az functionapp deployment source config-zip \
    --resource-group "$RESOURCE_GROUP" \
    --name "$FUNCTION_APP_NAME" \
    --src "$PACKAGE_ZIP" \
    --build-remote false \
    --output none
}

ingest() {
  preflight
  local artifact_dir="$1"
  [[ -d "$artifact_dir" ]] || fail "artifact directory not found: $artifact_dir"
  artifact_dir="$(cd "$artifact_dir" && pwd)"

  local storage_key job_name share_name execution_name status deadline
  storage_key="$(az storage account keys list \
    --resource-group "$RESOURCE_GROUP" \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --query '[0].value' -o tsv)"
  job_name="$(az deployment group show \
    --resource-group "$RESOURCE_GROUP" \
    --name cao-main \
    --query properties.outputs.ingestionJobName.value -o tsv)"
  share_name="$(az deployment group show \
    --resource-group "$RESOURCE_GROUP" \
    --name cao-main \
    --query properties.outputs.ingestionShareName.value -o tsv)"

  az storage file delete-batch \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$storage_key" \
    --source "$share_name" \
    --pattern '*' \
    --output none
  az storage file upload-batch \
    --account-name "$STORAGE_ACCOUNT_NAME" \
    --account-key "$storage_key" \
    --destination "$share_name" \
    --source "$artifact_dir" \
    --output none
  unset storage_key

  execution_name="$(az containerapp job start \
    --resource-group "$RESOURCE_GROUP" \
    --name "$job_name" \
    --query name -o tsv)"
  [[ -n "$execution_name" ]] || fail "Azure did not return an ingestion execution name"
  deadline=$((SECONDS + 7500))

  while :; do
    ((SECONDS < deadline)) ||
      fail "ingestion execution $execution_name did not finish within 125 minutes"
    status="$(az containerapp job execution show \
      --resource-group "$RESOURCE_GROUP" \
      --name "$job_name" \
      --job-execution-name "$execution_name" \
      --query properties.status -o tsv)"
    case "$status" in
      Succeeded)
        printf 'Ingestion succeeded: %s\n' "$execution_name"
        return
        ;;
      Failed | Degraded | Stopped)
        fail "ingestion execution $execution_name finished with status $status"
        ;;
      *)
        sleep 10
        ;;
    esac
  done
}

verify() {
  preflight
  local base="https://${FUNCTION_APP_NAME}.azurewebsites.net"
  curl --fail --silent --show-error --max-time 30 --retry 12 --retry-delay 10 --retry-all-errors \
    "$base/api/health" >/dev/null
  curl --fail --silent --show-error --max-time 30 --retry 12 --retry-delay 10 --retry-all-errors \
    "$base/api/readiness" >/dev/null

  local login_headers
  login_headers="$(mktemp)"
  trap 'rm -f "$login_headers"' RETURN
  curl --silent --show-error --dump-header "$login_headers" --output /dev/null "$base/auth/login"
  grep -Eiq '^location: https://github\.com/login/oauth/authorize' "$login_headers" ||
    fail "OAuth login did not redirect to GitHub"
  printf 'Health, readiness, and OAuth redirect checks passed for %s\n' "$base"
}

deploy() {
  local artifact_dir="$1"
  validate
  infrastructure
  package_functions
  publish
  ingest "$artifact_dir"
  verify
}

destroy() {
  [[ "${1:-}" == "--yes" ]] || fail "destroy requires the explicit --yes argument"
  preflight
  az group delete --name "$RESOURCE_GROUP" --yes --no-wait
  if [[ "$PURGE_PROTECTION" == false ]]; then
    az group wait --name "$RESOURCE_GROUP" --deleted
    az keyvault purge --name "$KEY_VAULT_NAME" --location "$LOCATION" --no-wait || true
  fi
  printf 'Deletion requested for %s\n' "$RESOURCE_GROUP"
}

COMMAND="${1:-}"
[[ -n "$COMMAND" ]] || {
  usage
  exit 1
}
shift
load_config "${1:-}"
shift || true

case "$COMMAND" in
  preflight) preflight ;;
  bootstrap) bootstrap ;;
  validate) validate ;;
  infrastructure) infrastructure ;;
  package) package_functions ;;
  publish) publish ;;
  ingest) ingest "${1:-}" ;;
  verify) verify ;;
  deploy) deploy "${1:-}" ;;
  destroy) destroy "${1:-}" ;;
  *)
    usage
    fail "unknown command: $COMMAND"
    ;;
esac
