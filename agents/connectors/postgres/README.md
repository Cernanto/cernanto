# Postgres

`connectors/postgres` runs one SQL statement at a time against a
PostgreSQL database, the parameters carried apart from the statement,
and answers the rows as objects, the number of rows touched, and the
database's reason when it refused the statement. The account is the
database's connection url; a named account is a second database.

## Connect

Nothing is set up in advance: the first call asks for the database's
connection details, as separate fields, in the terminal that made the
call and under `cernanto auth list`, with the steps the compile
found in the provider's own documentation for AWS RDS and Aurora, for
Neon and Supabase, and for a server of your own. The agent assembles
the connection url itself, so a password with any character in it is
safe; a local server that trusts its own connections needs no
password. Answer the ask where it printed, or from another terminal:

```
$ cernanto auth login connectors/postgres
```

The connection is encrypted for every host but the machine's own, the
server's certificate taken on trust (libpq's `sslmode=require`);
checking it against the provider's authorities is a later hardening.
An RDS instance is private to its VPC unless made publicly accessible:
the dev plane on a laptop reaches a public one, a plane on servers in the
same VPC reaches a private one. Details the database refuses (a wrong
password) are asked for again with the database's words; a database
that cannot be reached is an error.

## Verify it

The connector's own tests need one account and no fixture: they make a
table under a random name, write rows through parameters (one of them
a value that would be an injection if it were part of the statement),
read them back, and drop the table.

```
$ cernanto deploy connectors/postgres
```

## Use it

```
$ cernanto call connectors/postgres query statement="select now() as at"
$ cernanto call connectors/postgres query statement="select * from orders where order_id = \$1" parameters:='["A-1007"]'
```

The desks' real forms grant it in place of a sandbox store and read
its tables through a granted schema file:
`examples/workflows/invoice-approval/README.md` (purchasing) and
`examples/workflows/refund-desk/README.md` (the shop).
