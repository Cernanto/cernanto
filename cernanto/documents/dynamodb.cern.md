# cernanto/documents/dynamodb

Type: module

Implements: cernanto/documents
Uses: cernanto/config, npm:@aws-sdk/client-dynamodb@3.1159.0, npm:@aws-sdk/lib-dynamodb@3.1159.0, npm:@aws-sdk/client-s3@3.1159.0

The documents of a plane that runs on AWS, kept as items of one
DynamoDB table, the plane's own, the table the runtime keeps its
records in; a string above 64 KiB rides the plane's bucket beside it.
It reads the table when it is called and answers the documents
interface's three operations over it; a call made where no place is
named, and a listing that names less than a key's family, are
refused in words.

## The place and the identity

THE PLACE is the block's word `machine.substrate` in this copy's
working folder's `materialized.json`, read with the file system's own
read once and kept for the life of the process, when it is a
`dynamodb:` url,
`dynamodb://<region>/<table>?bucket=<bucket>`; when the mark names
another kind of place (a laptop's `file:` url), the configuration's
setting `place` names it, read through
cernanto/config. A process with neither refuses every call with
exactly `no DynamoDB place is named`. THE IDENTITY is the SDK's
default chain: the instance role through the metadata service on a
server, the operator's own sign-in on a laptop; the bucket is reached
with the same identity.

## The table

THE TABLE'S SHAPE is the runtime's: a partition key `pk` and a sort
key `sk`, both strings, the TTL on the attribute `expires`, every
kind of item an attribute set on it. A document's partition is `d#`
followed by the key's family, the key's text up to its first `/`
(`d#settings` for `settings/hosts.leaseMs`, `d#copies` for
`copies/20001/0`; a key with no slash is its own family); the sort
key is the whole key. The item carries `value` (the string,
when it is within 64 KiB), `revision` (a number, 1 at the first write
that lands and one more at every later one) and `nonce` (a random word
of the write's own, which a write resting on what stood names beside
the revision in its condition, so a key removed and made anew takes
the writes that rest on its new life alone). Every read is strongly
consistent (`ConsistentRead`).

A STRING ABOVE 64 KiB RIDES THE BUCKET the place names, and a place
naming no bucket refuses such a string in words. The item carries
`ref` in place of `value`, the key of the object
`documents/<the key>/<the revision>/<a nonce of this write's own>`,
one object per write, where the string is put as `text/plain;
charset=utf-8` before the item is written and read back from when the
item is read, listed or compared. An object found gone under a read,
a listing or a compare is followed once more through the item as it
stands now; an object gone a second time fails the call in words. The
object a landed write replaced, and a removed string's object, leave
the bucket a minute after the write landed; a process that ends
within that minute leaves the object where it is. A refused write
(the compare failed) reads its item once more before its object
goes: an item carrying the write's own nonce is the write landed,
answered so; otherwise the object leaves a minute later. A write the
store did not answer (its outcome unknown) leaves its object in the
bucket.

## The operations

READ answers the item's string and its revision as text, or null and
the revision 0 when there is no item.

WRITE is one conditional write resting on what stands, one attempt.
Resting on absence (`expected` null) it lands when no item stands;
resting on a string it lands when the item's string is that string,
at the next revision, and a string that moved is refused; a removal
(`value` null) rests on the same condition and deletes the item. The
answer says whether the write landed and carries the current string
either way, read again when the store refused the condition.

LIST answers every item of the family whose key begins with
the prefix, ordered by key, as one range read within the family's
partition, however many pages the store answers them in. A prefix names at least its family (`settings/`,
`copies/20001/`): a listing under an empty prefix and a prefix that
ends before its first `/` are refused in words.

## Tests

Uses: cernanto/config, npm:@aws-sdk/client-s3@3.1159.0, npm:@aws-sdk/lib-dynamodb@3.1159.0, npm:fs-extra

The tests learn the place the way the module does (the mark's
`machine.substrate` when it is a `dynamodb:` url, otherwise the
configuration's `place` through cernanto/config)
and make their own SDK clients for the table and the bucket it names,
with the same default chain of identity. They run live against that
table, under keys of a family named by a random token
(`test-<token>/...`), which they remove at the end, every other key
left as it is. They prove the compare-and-set round trip with the
lost race and the null removal, a listing that sees a write made
before it, a removed key absent to every read until a write resting
on absence lands over it, a key of plain text (keys that carry a `#`,
a `:`, a space and an `=`, letters beyond Latin and a character beyond
the Basic Multilingual Plane are each read under that exact key and
listed under the prefix that ends right before those characters), and
a string of 300 KiB that rides the
bucket: written resting on absence, read back whole, listed whole,
written over with another resting on it, removed, and its objects
gone from the bucket once the minute after the removal has passed,
read through the SDK and waited for.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
