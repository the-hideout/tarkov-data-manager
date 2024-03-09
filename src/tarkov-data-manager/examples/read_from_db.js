// after starting up the docker-compose stack with 'make run' exec onto this container and run:
// node examples/read_from_db.js

const Database = require('libsql');

const url = process.env.LIBSQL_URL;
const authToken = process.env.LIBSQL_AUTH_TOKEN; // not used currently

const opts = {
  authToken: authToken,
};

const db = new Database(url, opts);

const row = db.prepare("SELECT * FROM users WHERE id = ?").get(1);

console.log(`Name: ${row.name}, email: ${row.email}`);
db.close();
process.exit(0);
