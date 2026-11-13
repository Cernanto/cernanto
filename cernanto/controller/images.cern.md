# cernanto/controller/images

Type: module

Decide which checkpoint archives the plane removes. Given the images'
records, the images the slot records name and the moment, answer the
archives nobody names any more: the one before a copy's current
image, the archive of a dump whose record never named it, and every
pointer. Everything is handed in as arguments and the answer is data.

THE KEY of a copy is `<the agent id with every character outside
letters and digits as _>.<port>.<copy>`. AN ARCHIVE is named
`<key>.<n>-e<epoch>-<word>.img`, an object with a record of its own
carrying its meta, `{version: 1, key, agentId, port, copy, pid,
attempt, checkpoint, at, journals: [{subject, position}], stdio, bytes,
image, holder: {epoch, host}, hostImage?, signature}`, `image` the
archive's own name and `at` the moment its dump began. A record under
`images/` whose name ends in `.meta` is a pointer.

`decide` takes `{records, named, now}` and answers `{removals}`.
`records` lists the images' records, each `{name, size, at, meta?}`;
`named` lists the images the slot records name, each `{port, copy,
image}`, `image` the archive's name; `now` is the moment. An archive
is NAMED when an entry of `named` carries its name. `removals` lists,
sorted and each once, the names of every pointer (a name ending in
`.meta`) and of every archive that is not named and whose record's
`at` lies ten minutes or more before `now`. A named archive stays
whatever its age, and an archive not named and younger than ten
minutes stays for a later pass. The same input answers the same
output.

## Tests

Pure, over made-up records, named images and a moment, every rule
above a case of its own: a record whose meta is not whole is decided
as any archive, two keys are decided apart, the names come sorted and
each once, and the same input answers the same output twice.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
