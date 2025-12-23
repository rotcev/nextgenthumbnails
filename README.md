# pimpgen

## Dev database (Postgres on host)

Defaults assumed by the API if `DATABASE_URL` is not set:

- host: `localhost`
- port: `5432`
- user: `postgres`
- db: `pimpgen`

Create the DB (if needed):

```bash
psql -h localhost -p 5432 -U postgres -d postgres -c "CREATE DATABASE pimpgen;"
```

## Apps

- API: `apps/api`
- Web: `apps/web`



