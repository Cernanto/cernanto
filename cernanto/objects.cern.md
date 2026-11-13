# cernanto/objects

An interface: the plane's objects, named blobs of any size, as the
platform's agents reach them wherever the plane runs. An implementor
answers for the store the plane runs on, and every implementor is a
module linked into its consumer's process. A consumer binds it with no
name, and the plane binds the implementor of the store it runs on.

A name is a path of segments joined by `/`, plain text: an implementor
keeps and answers a name exactly as it was handed, whatever characters
its segments carry, and a store whose own names take fewer characters
converts inside its implementor. The plane's own names are
`packages/<digest>/c<number>/<n>` (the warehouse's package slices,
cernanto/packages) and `images/<key>/<archive>` (the host job's
checkpoint archives).

The operations:

- PUT a name with its bytes: a reader sees the whole object or none;
  a put of the same bytes under a name already there is answered as
  done.
- GET a name: its bytes, or null when there is none.
- PUT FILE a name from a file: the file at the path given (a file in
  the caller's own folder) becomes the object under the name, a
  reader seeing the whole object or none, and the path is empty
  afterwards. A tar of hundreds of megabytes rides this way.
- GET FILE a name into a file: the object's bytes written whole to the
  path given (a path in the caller's own folder, made fresh, the file
  appearing whole), answered as done, or null when there is no object
  under the name.
- REMOVE a name: gone, and a name already absent answers the same.
- LIST a prefix: every name under it.
- DESCRIBE a name: its size in bytes and the moment it was put, or
  null when there is none.

Type: interface

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
