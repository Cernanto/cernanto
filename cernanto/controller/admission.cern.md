# cernanto/controller/admission

Type: module

Decide what fits on the plane. Given the rows a ship carries, say
whether they may land on the fleet. Given the packages a landing
brings, say whether they may land over the agents already deployed.
Given the fleet, say which of its standing conditions hold. Everything
is handed in as arguments and every answer is data: the rows admitted,
or the exact sentence the operator reads when something is refused,
its `<placeholders>` filled in.

A row of the fleet is `{agentId, artifact, type? (absent means a
service), handlers, uses, usesContracts? (ids to sha256 hex pins),
implements? ([{id, contractSha}]), contract?, contractCompatibleWith?
(sha256 hex strings), package?, verified?, form?, testOf?, target?,
owner?, testerArtifact?}`, every other field carried along. A row is runnable
when its type is neither `module` nor `interface`. The service name of
an id is the id with every character outside letters, digits and
underscores replaced by an underscore.

## A ship

Given the protocol (a number) and the op (text) the ship names, its
rows, the fleet's rows as they stand and the digests the package
catalog holds, answer the rows admitted, each read into its shape, or
the first refusal in this order.

1. THE PROTOCOL. Refuse a protocol other than the number `0`, the wire
   major: `protocol <protocol> is not the wire major 0 this plane
   speaks`.
   Refuse an op other than `fleet.ship`: `op "<op>" is not
   fleet.ship`.
2. THE SHAPE AND THE PAIR RULES, row by row in the ship's order. A row
   carries `agentId` and `artifact` (non-empty text) and `handlers`
   and `uses` (lists of text). It may carry `type` (one of `service`,
   `task`, `job`, `worker`, `interface`, `module`), `testerArtifact`
   (non-empty text), `contract` (text), `usesContracts` (ids to text),
   `contractCompatibleWith` (a list of text), `implements` (entries
   `{id, contractSha}`, `id` non-empty), `form` (`test` or `tester`), `testOf`, `target` and `owner` (text);
every other field rides untouched.
   Refuse a row that does not fit: `the row of <agentId> does not fit:
   <field>: <why>`, the failing fields joined by `; `, or `row <index>
   of the ship does not fit: <field>: <why>` when the row names no
   agent. Refuse a row without `form` that carries `testOf`, `target` or `owner`:
`<agentId> carries testOf, target or owner but no form; only a
verification pair row (form test or tester) carries them`. A row
   that carries `form` is a VERIFICATION PAIR ROW. Its `owner` is a
   handle: letters, digits and underscores, a colon, digits or
   nothing, a colon, then at least one character; otherwise refuse
   `<agentId> is a verification <form> row whose owner is <absent, or
   the owner in double quotes>, not a handle
   <service>:<generation>:<key>`. It carries no `package`; otherwise
   refuse `<agentId> is a verification <form> row, never a permanent
   package installation; it carries no package`. A test form's id is
   `<target>-under-test-<compile>-r<round>` (the compile without a
   slash, the round digits); otherwise refuse `<agentId> is a test
   form whose id is not shaped <target>-under-test-<compile>-r<round>`.
   Its `testOf` is that target; otherwise refuse `<agentId> is a test
   form whose testOf is <absent, or the value in double quotes>; it
   must name its target <target>`. A tester's id is
   `<target>-tester-<compile>-r<round>`; otherwise refuse `<agentId>
   is a tester whose id is not shaped <target>-tester-<compile>-r<round>`.
   Its `testOf` is `<target>-under-test-<compile>-r<round>` with the
   same three parts; otherwise refuse `<agentId> is a tester whose
   testOf is <absent, or the value in double quotes>; it must name the
   test form <that id>`.
3. THE CATALOG. Refuse a row whose `artifact` is not among the digests
   the catalog holds: `<agentId>: artifact <the digest's first 19
   characters> is not in the package catalog; redeploy it with:
   cernanto deploy <agentId>`. Refuse a `testerArtifact` not among
   them: `<agentId>: tester artifact <its first 19 characters> is not
   in the package catalog; redeploy it with: cernanto deploy
   <agentId>`.
4. THE SPELLING. Refuse a row whose id's service name equals the
   service name of ANOTHER id, one on the fleet or one shipped beside
   it: `<agentId> and <other> would both be <service name> on the
   substrate; rename one`. The same id replacing its own row is no
   collision, and a package under a name the release ships replaces
   the release's row like any other.
5. THE CLAIMS. For each `implements` entry whose id does not start with
   `openapi:` (a document's stamp passes as claimed): the id names a
   row of `type: 'interface'` among the ship's rows or the fleet's;
   otherwise refuse `<agentId> implements <id>, which is no interface
   on the fleet or in this ship; deploy the interface first`. The
   entry's `contractSha` equals the sha256 hex of that interface row's
   `contract` text (an absent contract hashing as the empty text);
   otherwise refuse `<agentId> implements <id> at a different contract
   than the deployed interface; recompile it`.
6. THE PINS. For each id in the row's `uses` whose row, among the
   ship's rows first and the fleet's second, is a module row: the
   row's `usesContracts[<id>]` equals the sha256 hex of that module
   row's `contract` text (an absent contract hashing as the empty
   text) or is listed in its `contractCompatibleWith`; otherwise refuse
   `<agentId> pins <id> at <the pin's first 8 characters, or nothing
   when absent>; deployed is <the sha256's first 8>: recompile
   <agentId>, or promote <id> first`. An id with no module row anywhere
   passes.

## A landing

Given the packages of a landing's closure, in the closure's order
(each its agent id, whether it lands as installed, its needs, each an
id with the contract hash it wants when it wants one, its contract
hash and its compatible list), and the deployed rows, answer admitted
or the first refusal, package by package.

- A deployed row of the same id without the package mark (`package`)
  while the package lands as installed: refuse `"<id>" is deployed
  from a local compile; installing over it would shadow your own agent
  - remove it first (cernanto delete <id>)`. A deployed row with the
  mark while the package is the author's own: refuse `"<id>" is
  installed from a package; deploying your own agent over it would
  shadow the package - remove it first (cernanto delete <id>)`.
- A deployed row of another id whose service name equals the
  package's: refuse `"<id>" and the deployed "<other>" would both
  serve as "<service name>" on the substrate; rename one`.
- A need with a hash whose id is in the closure or deployed is met
  when that package's contract hash equals the need's or its
  compatible list holds it, or when the sha256 hex of that row's
  `contract` equals the need's or its `contractCompatibleWith` holds
  it. Refuse a need met by neither: `<id> needs <need> at <the hash's
  first 8 characters>, which is neither given nor deployed at that
  contract; deploy <need> at that contract first, or recompile <id>
  against the deployed one`. A need without a hash is met by presence,
  and a need whose id is nowhere is the install module's unresolved
  need.

## The standing conditions

Given the fleet's rows, answer three conditions, each `{type, status
('True'|'False'), reason, message}`.

- `DependenciesSatisfied`: `True`, reason `AllPresent`, message `every
  dependency is on the fleet` when every id in every row's `uses` is
  a row; else `False`, `MissingDependencies`, `missing: <the missing
  ids, sorted, joined ", ">`.
- `ContractsCompatible`, over THE STALE LINES, each line once. For each
  row and each entry of its `usesContracts` whose dependency is a
  module or an interface row, a pin that equals neither the sha256 hex
  of the dependency's `contract` nor a member of its
  `contractCompatibleWith` is the line `<agentId> pins <dependency> at
  <the pin's first 8 characters>; deployed is <the sha256's first 8,
  or none when the dependency carries no contract>: recompile
  <agentId>, or promote <dependency> first`. For each row carrying
  `package`, each entry of the package's `usesContracts` and
  `dependencies` maps whose dependency row carries a `contract` is
  checked the same way, with the same line. For each runnable row
  whose `uses` names a module row while its `usesContracts` has no
  entry for it, the line is `<agentId> carries no pin for module
  <module>: recompile <agentId>`. `True`, `Compatible`, `every
  dependency pin matches` without a line; else `False`, `StalePins`,
  `<the count> stale: <the lines joined "; ">`.
- `AgentsVerified`, over the rows whose type is absent, `service` or
  `module` and that carry no `form`: `True`, `Verified`, `every
  service and module is verified` when each carries `verified`; else
  `False`, `Unverified`, `unverified: <the ids in the fleet's order,
  joined ", ">`.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
