#!/usr/bin/env bash
# Provisions everything Myplace needs in a Cloudflare account and deploys it.
#
# Required environment:
#   CLOUDFLARE_API_TOKEN    token with Workers Scripts, Workers R2 Storage, Hyperdrive edit
#   CLOUDFLARE_ACCOUNT_ID   account the Worker deploys into
#   DATABASE_URL            hosted PostgreSQL with PostGIS (Neon, Supabase, RDS, ...),
#                           reachable from Cloudflare. Used for Hyperdrive and for the
#                           first migration + seed.
# Optional:
#   SESSION_SECRET          generated if unset
#   POSTMARK_SERVER_TOKEN   enables real sign-in and claim emails
#   MAIL_FROM               verified Postmark sender
#   SKIP_DEPLOY=1           provision only
set -euo pipefail

cd "$(dirname "$0")/.."

for var in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID DATABASE_URL; do
  if [[ -z "${!var:-}" ]]; then
    echo "error: $var is not set" >&2
    exit 1
  fi
done

WRANGLER="npx wrangler"
BUCKET="myplace-documents"
HYPERDRIVE_NAME="myplace-db"

echo "==> Cloudflare account"
$WRANGLER whoami

echo "==> R2 bucket: $BUCKET"
if $WRANGLER r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "    exists"
else
  $WRANGLER r2 bucket create "$BUCKET"
fi

echo "==> Hyperdrive config: $HYPERDRIVE_NAME"
# wrangler 4.x has no --json on hyperdrive list/create; use the REST API to look up
# existing configs and parse the created-id line from wrangler create.
HYPERDRIVE_ID="$(curl -sS \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/hyperdrive/configs" \
  | HYPERDRIVE_NAME="$HYPERDRIVE_NAME" node --input-type=module -e '
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (!body.success) {
      console.error((body.errors || []).map((e) => e.message).join("; ") || "hyperdrive list failed");
      process.exit(1);
    }
    const found = (body.result || []).find((item) => item.name === process.env.HYPERDRIVE_NAME);
    process.stdout.write(found ? found.id : "");
  ')"
if [[ -n "$HYPERDRIVE_ID" ]]; then
  echo "    exists ($HYPERDRIVE_ID); refreshing connection string"
  $WRANGLER hyperdrive update "$HYPERDRIVE_ID" --connection-string="$DATABASE_URL" >/dev/null
else
  CREATE_OUT="$($WRANGLER hyperdrive create "$HYPERDRIVE_NAME" --connection-string="$DATABASE_URL")"
  HYPERDRIVE_ID="$(printf '%s\n' "$CREATE_OUT" | sed -n 's/.*config: \([0-9a-fA-F-]\{32,\}\).*/\1/p' | tail -n 1)"
  if [[ -z "$HYPERDRIVE_ID" ]]; then
    echo "error: could not parse Hyperdrive id from wrangler create output" >&2
    printf '%s\n' "$CREATE_OUT" >&2
    exit 1
  fi
  echo "    created $HYPERDRIVE_ID"
fi

echo "==> Writing Hyperdrive id into wrangler.toml"
HYPERDRIVE_ID="$HYPERDRIVE_ID" node --input-type=module -e '
  import fs from "node:fs";
  const id = process.env.HYPERDRIVE_ID;
  const path = "wrangler.toml";
  const toml = fs.readFileSync(path, "utf8");
  const next = toml.replace(/(\[\[hyperdrive\]\][^\[]*?id = ")[^"]*(")/s, `$1${id}$2`);
  if (next === toml && !toml.includes(`id = "${id}"`)) {
    console.error("could not find the [[hyperdrive]] id line in wrangler.toml");
    process.exit(1);
  }
  fs.writeFileSync(path, next);
'

echo "==> Secrets"
SESSION_SECRET="${SESSION_SECRET:-$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')}"
printf '%s' "$SESSION_SECRET" | $WRANGLER secret put SESSION_SECRET
if [[ -n "${POSTMARK_SERVER_TOKEN:-}" && -n "${MAIL_FROM:-}" ]]; then
  printf '%s' "$POSTMARK_SERVER_TOKEN" | $WRANGLER secret put POSTMARK_SERVER_TOKEN
  printf '%s' "$MAIL_FROM" | $WRANGLER secret put MAIL_FROM
else
  echo "    POSTMARK_SERVER_TOKEN / MAIL_FROM not set: emails will be recorded but not delivered"
fi

echo "==> Database"
# --input-type=module: tsx -e otherwise evaluates as CommonJS, where top-level await is rejected.
HAS_SCHEMA="$(DATABASE_URL="$DATABASE_URL" npx tsx --input-type=module -e '
  import postgres from "postgres";
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });
  const r = await sql`SELECT to_regclass(${"public.properties"}) AS t`;
  process.stdout.write(r[0].t ? "yes" : "no");
  await sql.end();
')"
if [[ "$HAS_SCHEMA" == "yes" ]]; then
  echo "    schema already present; skipping migrate + seed"
else
  echo "    applying migrations and demonstration seed"
  DATABASE_URL="$DATABASE_URL" SESSION_SECRET="$SESSION_SECRET" npm run setup
fi

if [[ "${SKIP_DEPLOY:-}" == "1" ]]; then
  echo "==> SKIP_DEPLOY=1, provisioning finished"
  exit 0
fi

echo "==> Build and deploy"
npm run build
$WRANGLER deploy

echo
echo "Done. wrangler.toml now carries the Hyperdrive id; commit it."
echo "Sign in as admin@myplace.local with code 000000 (seeded) to review claims."
