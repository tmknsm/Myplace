# Myplace

A living property record for New York. V1 covers **Columbia and Greene** counties with a source-aware public dossier, owner-maintained layer, and a production-looking ownership claim flow. The two counties exist so both polygon cases are visible.

> Every New York property, organized in one place. Know what’s official, what’s changed, and add what only you know.

Owner verification is **manual review** in this V1. The claim UI, emails, and admin desk are the production experience. Locally, those emails land in a development mailbox instead of Postmark.

## What V1 includes

- Searchable demonstration parcels for Columbia County, plus official Greene County lot lines from the NYS public tax-parcel file
- Mapbox-ready map (OpenFreeMap locally; optional Mapbox token later)
- Public property page with provenance, unknown, inferred, and conflicting states
- Email sign-in codes
- Claim this property wizard + claim status
- Admin claim review
- Owner record, document vault (`private` / `property_transferable`), and handoff invitation
- Immutable property event history
- Postgres + PostGIS schema designed for later NY adapters

Columbia County does not authorize public redistribution of official parcel geometry through the NYS tax-parcel service. Those lots are a **demonstration sketch** along real streets, labeled as such in the UI.

Greene County does authorize public redistribution. The seed includes a Village of Catskill sample from the **2025 NYS Tax Parcels Public** dataset — official county tax-map polygons, not sketches.

## Stack

- React + Vite
- MapLibre (Mapbox-compatible)
- Hono API (Node locally, Cloudflare Worker entry in `server/src/worker.ts`)
- PostgreSQL + PostGIS
- Local document store that mirrors an R2 key layout
- Local mailbox standing in for Postmark

## Local setup

```bash
sudo apt-get install -y postgresql postgresql-contrib postgresql-16-postgis-3
sudo service postgresql start
sudo -u postgres createuser -s "$USER" || true
sudo -u postgres createdb -O "$USER" myplace
sudo -u postgres createdb -O "$USER" myplace_test
psql -d myplace -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"
psql -d myplace_test -c "CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# If using system Postgres created for the ubuntu user:
#   sudo -u postgres psql -c "ALTER USER ubuntu WITH PASSWORD 'myplace';"

cp .env.example .env
npm install
npm run setup
npm test
npm run dev
```

Or use Docker for Postgres:

```bash
docker compose up -d
DATABASE_URL=postgres://ubuntu:myplace@localhost:5432/myplace npm run setup
```

App: [http://localhost:5173](http://localhost:5173)  
API: [http://localhost:8787](http://localhost:8787)

## Local development flow

1. Search `441 Warren Street` (Columbia sketch) or `1 Main Street` (Greene official lot lines), or click a parcel on the map. Use the Columbia / Greene chips to fly between the two cases.
2. Sign in with any email. Open **Mailbox** in the local-development bar, read the code, return to sign-in.
3. Claim the property. The wizard is the production UI.
4. Open **Admin review**, verify the claim.
5. Return to the mailbox, then open the owner record.

`admin@myplace.local` is seeded as an administrator. Request a code for that address the same way.

## Tests

```bash
npm test
```

Uses `myplace_test` and covers fact assembly, search, claim review, owner assertions, and maintainer transfer.
