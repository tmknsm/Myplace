# Myplace

A living property record for New York. V1 covers **Columbia County** with a source-aware public dossier, owner-maintained layer, and a production-looking ownership claim flow.

Owner verification is **manual review** in this V1. The claim UI, emails, and admin desk are the production experience. Locally, those emails land in a development mailbox instead of Postmark.

## What V1 includes

- The **2025 NYS ORPTS local assessment roll** for Columbia County (~36,800 parcels) via [Open Data NY](https://data.ny.gov/Government-Finance/Property-Assessment-Data-from-Local-Assessment-Rol/7vem-aaz7)
- 2024→2025 assessment and owner-of-record changes as property events
- Map shapes from OpenStreetMap when an address matches, otherwise an approximate NY East grid rectangle
- Mapbox-ready map (OpenFreeMap locally; optional Mapbox token later)
- Public property page with provenance, unknown, inferred, and conflicting states
- Email sign-in codes
- Claim this property wizard + claim status
- Admin claim review
- Owner record, document vault (`private` / `property_transferable`), and handoff invitation
- Immutable property event history

Columbia County is **not** in the NYS public tax-parcel redistribution program and sells countywide shapefiles under a data-sharing agreement. This app does **not** scrape county GIS. Official lot lines are absent; facts come from the statewide roll ORPTS already publishes.

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
npm run setup   # migrate + import the ORPTS roll (needs network)
# npm run db:seed   # optional tiny synthetic set if you are offline
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

1. Search `441 Warren` or click a parcel on the map. That Hudson address is a real 2025 roll row.
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
