#!/usr/bin/env bash
# Non-mutating CLI availability check; does not invoke a model or remote VM.
set -euo pipefail
[[ "$(uname -s)" == Linux ]] || { echo 'blocked: linux_required' >&2; exit 65; }
export PATH="$HOME/.local/bin:$PATH"
command -v agy >/dev/null || { echo 'blocked: agy_not_installed' >&2; exit 69; }
agy --version
agy --help >/dev/null
echo 'cli_verified: binary responds; authentication, git, API and VM execution untested'
