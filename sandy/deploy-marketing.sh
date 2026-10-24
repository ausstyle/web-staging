#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${SANDY_FIREBASE_PROJECT:?Set SANDY_FIREBASE_PROJECT to the existing or newly created Firebase project ID}"
mkdir -p firebase-public
cp index.html firebase-public/index.html
firebase deploy --only hosting --project "$SANDY_FIREBASE_PROJECT"
