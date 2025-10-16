#! /usr/bin/env bash

set -e

SENTRY_ORG=desci-labs
SENTRY_PROJECT=dpid-resolver

if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "ℹ SENTRY_AUTH_TOKEN not set, skipping sourcemaps upload"
  exit 0
fi

npx -y sentry-cli sourcemaps inject --org $SENTRY_ORG --project $SENTRY_PROJECT dist
npx -y sentry-cli sourcemaps upload --org $SENTRY_ORG --project $SENTRY_PROJECT dist

echo "✅ Sourcemaps uploaded to sentry"
