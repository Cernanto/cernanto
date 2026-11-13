# cernanto/documents/sqlite

Type: module

Implements: cernanto/documents

The documents of a plane of one machine, the laptop's, kept in the
plane's one SQLite database file, `plane.sqlite`, through Node's own
`node:sqlite`, the file the runtime's own records share with the
agents' documents. It reads the file when it is called, answers the
documents interface's three operations over its `documents` table,
and serves from the plane's first boot.

## The file

The file lives under the plane's folder, the block's word
`machine.plane` in this copy's working folder's `materialized.json`,
read with the file system's own read once and kept for the life of
the process, and its `machine.root` when the mark names no `plane`; a mark naming
neither refuses the call with exactly `the block's mark names no
root`. The host job, the copies and the cli share the file: it is
opened in write-ahead mode, and a write waits up to five seconds for
another writer.

## The table

THE TABLE, made when absent, is the runtime's own shape in the same
file: `documents(key TEXT PRIMARY KEY, value TEXT, revision INTEGER
NOT NULL, expires INTEGER)` with an index on `expires`. The runtime
writes a record's removal as a row with a null value and `expires`
0, and A REMOVED ROW, one with a null value or with an `expires` at
or before the moment of a read, is absent to that read. A key's
revision starts at 1 and grows by one at every write that lands.

## The operations

READ answers the row's string and its revision, or null and the
revision 0 when there is no row or the row is a removed one.

WRITE is one attempt, all of it or none. Resting on absence
(`expected` null) it lands when no row stands but a removed one,
over a removed row too; resting on a string it lands when the row's
value is that string, the revision grown by one; a removal (`value`
null) rests on the same condition and deletes the row. The answer
carries whether the write landed and the current string after it, a
lost race answering the string that stands.

LIST answers every row whose key starts with the prefix, removed rows
left out, ordered by key, read as one range over the primary key, so a
listing's cost follows the rows it answers whatever the table holds.

THE TRIM runs inside a write that lands, at most once a minute in a
process: the removed rows whose `expires` is more than a minute behind
the moment are deleted.

## Tests

The tests run on the live plane against its own database file, under
keys of a family named by a random token (`test-<token>/...`), which
they remove at the end, every other key left as it is. They prove the
compare-and-set round trip with the lost race and the null removal, a
listing that sees a write made before it, a removed key absent to
every read until a write resting on absence lands over it, and a key
of plain text: keys that carry a `#`, a `:`, a space and an `=`,
letters beyond Latin and a character beyond the Basic Multilingual
Plane are each read under that exact key and listed under the prefix
that ends right before those characters.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
