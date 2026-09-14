# Myplace

A living property record for New York. V1 covers **Columbia and Greene** counties with a source-aware public dossier, owner-maintained layer, and a production-looking ownership claim flow. The two counties exist so both polygon cases are visible.

> Every New York property, organized in one place. Know what’s official, what’s changed, and add what only you know.

Owner verification is **manual review** in this V1. The claim UI, emails, and admin desk are the production experience. Locally, those emails land in a development mailbox instead of Postmark.

## What V1 includes

- Every parcel in Columbia (≈36.8k) and Greene (≈38.4k) counties, imported from public New York sources by `npm run db:import`
- Parcel lot lines served as PostGIS vector tiles (`/api/tiles/{z}/{x}/{y}.mvt`), colored by how trustworthy they are
- Mapbox-ready map (OpenFreeMap locally; optional Mapbox token later)
- Property profile: cover photo hero, key facts, and every official fact with provenance, unknown, inferred, and conflicting states
- Email sign-in codes
- Claim this property wizard + claim status for unclaimed parcels; once a property has a verified owner, transfer happens through their handoff invitation
- Admin claim review
- Owner layer on the same profile: about, photos, improvements, and home systems are public by default and can be made private field by field; the document vault (`private` / `property_transferable`) and handoff invitation stay owner-only
- Immutable property event history
- Postgres + PostGIS schema designed for later NY adapters

## Data sources and the two polygon cases

Every lot line carries a quality tier that the map legend, the property page notice, and the `geometry.kind` fact all reflect:

| County | Lot-line policy | What the importer loads | Quality |
| --- | --- | --- | --- |
| Greene | Authorizes NYS to redistribute its tax map | All 38.4k parcels from the **NYS Tax Parcels Public** feature service: official county polygons plus the joined 2025 assessment attributes | `official` |
| Columbia | Does **not** authorize redistribution | All 36.8k parcels from the **NYS ORPTS assessment roll** (Open Data NY `7vem-aaz7`, 2025 with 2024 for change events). Shapes are an address-matched OpenStreetMap footprint where one exists, otherwise a rectangle placed from the roll's NY East grid coordinates | `approximate` |

The offline sample seed (`npm run db:seed`) uses a third tier, `demonstration`, for its hand-drawn Columbia sketches. Nothing in the approximate or demonstration tiers is ever presented as the county tax map.

```bash
npm run db:import                    # full reload of every county (~2 minutes, needs network)
npm run db:import -- --county=Greene # reload one county in place; users and claims survive
npm run db:overlays                  # FEMA flood, NWI wetlands, SHPO historic, Catskill zoning
npm run db:seed                      # offline 160-parcel sample instead
```

`db:overlays` does not wipe parcels. It spatially joins public layers onto lots that already have a shape:

| Fact | Source | Coverage |
| --- | --- | --- |
| FEMA flood zone | FEMA National Flood Hazard Layer | Every parcel with a shape; lots that miss the NFHL polygons are labeled explicitly |
| Wetlands | USFWS National Wetlands Inventory | Same; NWI is a screening layer, not a jurisdictional delineation |
| Historic district | NYS SHPO National Register listings | Districts and individual listings; everyone else is “not in a listed district” |
| Zoning district | Town + Village of Catskill official GIS (2013) | **Catskill only.** New York has no statewide zoning layer; other municipalities stay unknown rather than inventing a district |

Importers live in `db/adapters/`; adding a county means adding one adapter and one profile in `server/src/counties.ts`.

## Stack

- React + Vite
- MapLibre (Mapbox-compatible)
- Hono API (Node locally, Cloudflare Worker in production)
- Neon Postgres + PostGIS for parcel and owner data
- Cloudflare R2 for photo and document files (`myplace-documents`)
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
npm run setup          # migrate + import both counties (use `npm run setup:sample` offline)
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

## Production

Live: [https://myplace.6point1five.workers.dev](https://myplace.6point1five.workers.dev)

The app is a Cloudflare Worker with the Vite build as static assets. Postgres (Neon + PostGIS) is reached through Hyperdrive; photos and documents go to the `myplace-documents` R2 bucket.

```bash
npm run deploy
```

Sign-in emails are stored in Postgres and only delivered when `POSTMARK_SERVER_TOKEN` and `MAIL_FROM` are set as Worker secrets. Until those exist, mint a one-off code in the `auth_codes` table (hashed with `SESSION_SECRET`) rather than using the local debug mailbox.

## Local development flow

1. Search `441 Warren Street` (Columbia, approximate lot lines) or `1 Main Street` (Greene, official lot lines), or click a parcel on the map. Use the Columbia / Greene chips to fly between the two cases.
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
