# Postgres

Uses:

- cernanto/auth
- npm:pg@^8

A PostgreSQL database. The account is the database's connection
details, asked for as separate fields on the first call under the
provider `postgres`, never as one url the person must assemble, with
the steps for an AWS RDS or Aurora database, for a Neon or Supabase
database, and for a server of one's own. The connection is encrypted
for every host but the machine's own, the server's certificate taken
on trust; a named account is a second database connected under that
name. Given a
statement and its parameters separately, run it against the account's
database and answer the rows as objects, named by their columns, and
the number of rows the statement touched; a parameter is a value,
never part of the statement, whatever it contains. A statement the
database refuses is a normal answer, refused, with the database's
reason; only a database that cannot be reached is an error, and a login
the database refuses, or a database name it does not know, is such an
error too.

## Tests

Make a table under a fresh random name, write rows into it and read
them back through parameters, then drop it, so nothing the tests make
outlives them.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
