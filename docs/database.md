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

## Local Development

This is the *safe* section for doing pure local development without the risk of connection to the AWS S3 replica in anyway.

### Requirements

1. Install Docker
2. Ensure docker-compose is installed
3. Create a `src/libsql/creds.env` file with the following content:

    ```ini
    LIBSQL_BOTTOMLESS_AWS_ACCESS_KEY_ID=nothing
    LIBSQL_BOTTOMLESS_AWS_SECRET_ACCESS_KEY=nothing
    ```

4. Pull the database dump down from Google Drive and unzip it. Make note of where you save it as we will use it in a moment

### Starting the Stack

For the first time you launch the docker-compose stack, it will start the `libsql` servers with an empty database. We need to do this only for the first time so that the proper directory structure is setup for us to inject our own database dump.

Run the following command and wait for everything to start up:

```bash
make run
```

Once everything has started up okay, kill the stack with:

```bash
make stop
```

You should see a new directory in this repo called: `data/libsql_data/iku.db/dbs/default`. This is a shared docker volume that is accessible to the `libsql` server and also your host operating system. We will use this directory to inject our own database dump.

Copy the database dump you downloaded earlier into this directory and overwrite the `data` file. The `data` file is an empty `sqlite` compatible database file that is created when the stack is first started. We want to overwrite this with our own database dump which is our entire production database (snapshot of it at least) in `sqlite` format.

```bash
cp /path/to/your/database/dump data/libsql_data/iku.db/dbs/default/data
```

Start the stack up again:

> Please note, it might take the stack a moment to launch and your CPU might get nailed at 100% for a few minutes as the `2.5GB` database is initialized.

```bash
make run
```

To test if everything worked, you can `exec` onto the `curl` container that is running in the stack and execute the following command:

```bash
curl -d '{"statements": ["SELECT count(*) FROM price_data"]}' db_proxy:8080
```

If everything worked okay, the `curl` container will send a requeset to the `db_proxy` (nginx) which will then forward the request to the `libsql` **replica** which will then query the `sqlite` database and return the result to the `curl` container which will then print the result to the console.
