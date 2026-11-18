# cernanto/objects/files

Type: module

Implements: cernanto/objects
Uses: npm:fs-extra

The objects of a plane of one machine, the laptop's, kept as plain
files under `objects` in the plane's folder: a name's segments are
the folders and the file under it, the folders made as needed. A name
is plain text and a file's name is not, so this module spells each
segment into the name of its folder or file (THE FILE'S NAME below)
and answers every name exactly as it was handed. It answers the
objects interface's seven operations over those files and serves from
the plane's first boot.

## The file's name

A name is any text whose segments, split at `/`, are each neither
empty nor `.` nor `..`; a name with such a segment is refused in
words. THE FILE'S NAME of a segment is the segment spelled one UTF-16
unit at a time: a unit of `A-Za-z0-9_.-` as itself, `=` as `==`, and
every other unit as `=` followed by its four lowercase hex digits,
four always (the segment `sha256:ab12` is the folder `sha256=003aab12`,
and a character beyond the Basic Multilingual Plane is two such
units). Read back, `==` is `=` and `=` with four hex digits is that
unit, so a file's name is one segment's and no two segments share a
file. The runtime's own reader of this folder spells a segment the
same way.

## The folder

The plane's folder is the block's mark in this process's working
folder, `materialized.json`, read with the file system's own read
once and kept for the life of the process: its `machine.plane`, and
its `machine.root` when the mark names no `plane`. A mark naming neither
refuses every call with exactly `the block's mark names no root`.

## The operations

PUT makes the file under the name whole, a reader seeing the whole
object or none; a target whose bytes are the given ones already (the
same length and the same sha256) is answered as done, the file left
as it is. GET answers the file's bytes whole, null when there is
none. PUT FILE makes the file given the object under the name, its
folders made as needed, a reader seeing the whole object or none and
the file gone from its path afterwards; a target already there is
replaced. GET FILE writes the object to the path given, the file
appearing whole, answered as done, or null when there is no object.
REMOVE deletes the file, a name with no file answering the same, and
removes the folders left empty above it up to the root. LIST answers
the name of every file under the prefix, each as it was handed, the
files' names read back into segments, the prefix matched by whole
segments. DESCRIBE answers the file's size and its modification
moment, or null.

## Tests

The tests run on the live plane under names of their own, under a
prefix named by a random token, and remove every object they put at
the end, the folder with them, every other object left as it is.
They prove the round trip of bytes of a few megabytes, the same-bytes
put answered with the file left as it is, the put of a file and the
get into a file (the file gone from its path after the put, the bytes
whole after the get), the listing of a prefix, the description's
size, the removal of a name twice, and a name of plain text: names
whose segments carry a `:`, a `#`, a space and an `=`, letters beyond
Latin and a character beyond the Basic Multilingual Plane each hold
their own bytes, and are listed under their prefix exactly as they
were handed.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
