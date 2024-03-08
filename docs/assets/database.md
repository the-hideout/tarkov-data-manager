# Database

During local development, you can optionally connect to the production database at your own risk.

You will need to create the following file: `src/libsql/creds.env.example` and rename it to `src/libsql/creds.env`.

Then ensure it has the following variables:

```ini
LIBSQL_BOTTOMLESS_AWS_ACCESS_KEY_ID=<token>
LIBSQL_BOTTOMLESS_AWS_SECRET_ACCESS_KEY=<token>
```

Replace `<token>` with our production AWS credentials.

If `SQLD_ENABLE_BOTTOMLESS_REPLICATION=true` is set in the `docker-compose.yml` file, the database will be replicated to your local machine and also synced with the production database.
