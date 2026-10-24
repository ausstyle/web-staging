#!/usr/bin/env bash
# Antigravity CLI bootstrap for existing Sandy engineering VM.
# Source-only helper: merging never executes this script remotely.
set -euo pipefail

readonly INSTALLER_URL='https://antigravity.google/cli/install.sh'
readonly EXPECTED_HOST='sandy-deploy'
readonly EXPECTED_PROJECT='elaborate-haven-511518-a5'
readonly EXPECTED_ZONE='europe-west1-b'

action="\${1:-}"
if [[ "$#" -ne 1 || ( "$action" != '--preflight' && "$action" != '--install' ) ]]; then
  echo 'Usage: bash bootstrap.sh --preflight | --install' >&2
  exit 64
fi
[[ "$(uname -s)" == Linux ]] || { echo 'blocked: linux_required' >&2; exit 65; }
[[ "$(id -u)" != 0 ]] || { echo 'blocked: unprivileged_user_required' >&2; exit 65; }
for cmd in curl bash sha256sum git uname id; do
  command -v "$cmd" >/dev/null || { echo "blocked: missing_dependency:$cmd" >&2; exit 69; }
done
case "$(uname -m)" in
  x86_64|aarch64) ;;
  *) echo 'blocked: unsupported_architecture' >&2; exit 65 ;;
esac
# The approved VM-access handler must independently bind resource identity;
# the environment variables below are fail-closed assertions, not IAM proof.
if [[ "\${SANDY_TARGET_INSTANCE:-}" != "$EXPECTED_HOST" ||
      "\${SANDY_TARGET_PROJECT:-}" != "$EXPECTED_PROJECT" ||
      "\${SANDY_TARGET_ZONE:-}" != "$EXPECTED_ZONE" ]]; then
  echo 'blocked: target_identity_not_confirmed' >&2
  exit 77
fi
printf 'preflight: target=%s project=%s zone=%s\n' "$EXPECTED_HOST" "$EXPECTED_PROJECT" "$EXPECTED_ZONE"
if command -v agy >/dev/null 2>&1; then
  agy --version || { echo 'blocked: installed_cli_unhealthy' >&2; exit 70; }
fi
if [[ "$action" == '--preflight' ]]; then
  echo 'preflight_complete: no_installation_performed'
  exit 0
fi

expected="\${ANTIGRAVITY_INSTALLER_SHA256:-}"
[[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo 'blocked: approved_installer_sha256_required' >&2; exit 77; }
umask 077
tmpdir="$(mktemp -d)"
trap 'rm -rf -- "$tmpdir"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "$INSTALLER_URL" --output "$tmpdir/install.sh"
actual="$(sha256sum "$tmpdir/install.sh" | cut -d' ' -f1)"
[[ "$actual" == "$expected" ]] || { echo 'blocked: installer_checksum_mismatch' >&2; exit 65; }

# Execute only the independently reviewed, digest-pinned installer.
bash "$tmpdir/install.sh" --skip-aliases
export PATH="$HOME/.local/bin:$PATH"
command -v agy >/dev/null || { echo 'blocked: cli_binary_missing' >&2; exit 70; }
agy --version
echo 'installation_verified: cli_version_readback_only; authentication_and_headless_run_not_verified'
