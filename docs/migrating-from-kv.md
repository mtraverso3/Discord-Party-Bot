# Migrating from the KV / Durable Object version

Deployments that predate D1 kept their state in Workers KV and Durable Objects.
This only applies to those. A fresh install has nothing to migrate.

After deploying the D1 version, call `POST /admin/api/import-kv` once through
the Access-protected admin API. It copies the durable data into D1: IGN
profiles, guild settings, templates and desktop-client tokens. Live parties are
ephemeral and start fresh.

The import is idempotent, so it is safe to re-run; existing D1 rows are
overwritten with the KV values.

Once the data is verified, remove the `PARTY_KV` binding from `wrangler.toml`
and delete `src/admin/import.ts`.
