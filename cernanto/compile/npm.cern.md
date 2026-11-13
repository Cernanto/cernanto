# cernanto/compile/npm

Type: module

Uses:

- cernanto/compile/contract
- cernanto/config
- cernanto/machine
- npm:typescript
- npm:execa
- npm:fs-extra

Install the npm packages a compile workspace's `package.json` names,
at the versions its lock pins, and read what the compile needs to know
about them: make every granted package type-checkable where it can
be, answer the version each package was installed at for the
compile's pins, and answer the entry declaration a coder's import
resolves to, with the map of the declaration files it reaches, for
the code prompt. Everything runs inside one workspace directory and
answers data. Declarations are read with the TypeScript compiler's
own resolver and parser (the granted package). npm runs as a child
process through the granted process package, by the command the
machine answers for npm's arguments: the machine interface bound with no name, the implementor the plane
binds; a binding that is unavailable
fails the call.
Every command is awaited.

## Installing

`installPackages` runs `npm` in the workspace with exactly the
arguments `install --no-audit --no-fund --loglevel=error`, and
`--omit=optional` after them when the caller skips optional
dependencies (the platform's own compiles). Lifecycle scripts run as
npm's own configuration says, so a package that compiles or downloads
at install does so here as on a developer's machine, and an operator
turns them off with npm's `ignore-scripts` setting. A non-zero exit
fails with `npm install failed in the workspace: ` followed by the
first 2000 characters of npm's standard error. The child sees the
machine's basics and npm's own configuration: the basics of a child's
environment on this system as the machine answers them, and, of the
environment the caller hands in with the input, every variable
starting with `npm_config_` or `NPM_CONFIG_`; when the caller hands
no environment in, the child inherits this process's environment
whole, as the process package hands it on. That composition over a
given environment is also answered on its own (`installChildEnv`).

THE LOCK MEMO: keep the lock of the last install of the same
dependency set beside the compile cache and seed it into the
workspace, so npm resolves nothing the lock settles. The set's key is
the first 32 hex characters of the sha256 of the JSON text of
`{"dependencies": <the package.json dependencies as [name, range]
pairs sorted by name>, "omitOptional": <true or false>}`; a manifest
without dependencies, or one that cannot be read, has no key and no
memo. When a lock cache directory is given, the memo lives at `<lock
cache>/<key>.json`; before the install, a workspace without a
`package-lock.json` copies the memo in when one exists (a copy that
fails costs the round trips alone); after a successful install the
workspace's lock is copied to a temporary sibling of the memo (a name
no other compile running beside this one can pick) and renamed over
the memo, so a reader always sees a whole memo (a failure of that copy
leaves the install as it succeeded). The lock ships in the artifact as
`npm-shrinkwrap.json`, so every environment reproduces the exact tree.

A LOCK GIVEN with the install (`lockPath`: the lock a package carries,
the exact tree its compile certified) is copied into the workspace as
`package-lock.json` before the memo is considered, so the install
lands that tree and resolves nothing the lock settles. THE MANIFEST IS
MADE TO AGREE WITH THE LOCK FIRST: every dependency the lock's root
entry states (`packages[""].dependencies`) that the workspace's
`package.json` lacks is added to the manifest's `dependencies` at the
range the lock states, the manifest written back as two-space JSON
with a trailing newline, before npm runs (the types twins a previous
compile ensured are part of the certified tree and stay in it). A
workspace given a lock takes no memo, and after a successful install
its lock is still copied out as the memo, as above. A given lock that
cannot be read fails with `the lock at <path> could not be read: <the
failure's words>` before npm runs.

## Types

Whether a granted package resolves to type declarations
(`npmGrantResolvesTyped`) is decided the way the check gate's tsc
decides it: resolving the package name from `<workspace>/src/index.ts`
with module and module resolution `NodeNext` and target `ES2023` over
the real file system, and reading the result as typed only when the
resolved file's extension is one of `.d.ts`, `.d.mts`, `.d.cts`, `.ts`
or `.tsx` (the resolver's secondary pass answers plain `.js` files
too, and those read as typeless). The DefinitelyTyped twin of a
package (`typesPackageNameOf`) is `@types/<name>`, and for a scoped
package `@types/<scope without the @>__<name>`; the reverse mapping
(`typedPackageOf`) reads `@types/a__b` as `@a/b`.

Making every granted package type-checkable (`ensureTypes`) takes the
package names and their pins: a name starting with `@types/` is
skipped; a package that already resolves typed needs nothing; one
whose pin starts with `file:` or `link:` is a hand-provided package,
counted as typeless with no registry lookup; every other one is a
candidate whose twin is PROBED in the registry (`npm view <twin>
version --loglevel=error` in the workspace, the same child
environment, a zero exit meaning it exists). The twins that exist are
installed together with `npm install --save --no-audit --no-fund
--loglevel=error [--omit=optional] <twins...>` (the omit flag rides
EVERY install of a workspace that skips optionals: a later install
without it reifies the tree and quietly reinstalls the natives the
first kept out); a non-zero exit of that install reads `npm install
of <twins joined by ", "> failed: ` and the first 2000 characters of
standard error, and the ensure catches it, since the declarations are
an assist, and counts those packages as typeless instead. The answer
is the typeless packages sorted. A caller may install a registry
RUNNER that answers the probe and the install in place of npm (a test
off the network): installing one (`setNpmTypesRunner`) answers a
function that restores the previous runner, and a runner given
directly to the ensure (`ensureNpmTypes`) wins over the installed one.

## The installed versions

The version each granted package was installed at
(`installedVersions`), for the compile's pins: for the names asked, in
the order asked, the package's directory is resolved the way node
resolves it (a `node_modules/<name>` beside the workspace, then beside
each parent folder, real paths taken) and its own manifest read; each
answer carries the package's name and the installed version from its
manifest (`0.0.0` when the manifest names none, `missing` when the
package is not installed).

## The entry declaration

The declaration a coder's import of a package lands on
(`entryDeclaration`) is resolved from `<workspace>/src/__entry_probe.ts`
with the same options and the ESNext import mode (the workspace is an
ES module project, so the import takes a package's `import`
condition; the mode is what makes the resolver pick the `import` twin
rather than the `require` one, the path tsc itself picks). A package
that resolves to no declaration file (the resolved file must end in
`.d.ts`, `.d.mts` or `.d.cts`), or whose file cannot be read, answers
nothing. The answer carries the file's path relative to the
workspace's REAL path (tsc answers real paths, and a workspace named
through a symlink starts from its real one too), its text cut at
24000 bytes with a truncation flag, the subpaths the package's
`exports` map allows (its keys starting with `./` and carrying no `*`,
in the map's order; none when the manifest has no object map), and
the map of the declaration files the entry reaches: a breadth-first
walk of the entry's relative import and export specifiers (import
declarations, export declarations and `import("...")` type nodes
whose specifier starts with `.`), each specifier tried as a `.js`
suffix read as `.d.ts`, `.mjs` as `.d.mts`, `.cjs` as `.d.cts`, a
declaration suffix as itself, then `<path>.d.ts`, `<path>.d.mts`,
`<path>/index.d.ts` and `<path>/index.d.mts`, the first existing real
path taken, inside the package's own directory only (the nearest
ancestor of the entry with a package.json, so a DefinitelyTyped twin
maps its own tree), each file once and the entry itself left out of
the map, at most 64 files with a flag saying the walk stopped at the
cap. Each mapped file carries its path
relative to the package root, its byte length, and its exported names
in order, each as `<name>@<the line its declaration starts on>`: the
declarations carrying the export modifier (functions, classes,
interfaces, type aliases, enums, namespaces, each variable of an
exported statement), the names of export lists (each carrying the line
the export statement starts on), a namespace export's name, and
`default` for an export assignment, each once.

## Tests

Uses: npm:fs-extra

Every operation works inside a workspace directory: make one in a
temporary folder with the granted file package, write its
`package.json` with the dependencies to try, and hand the directory
to the operations; remove the folder at the end. The registry is
real, and the machine the installs run through is the plane's own,
the implementor the plane binds. Keep the packages small and
settled: `weather-js` has no
declarations anywhere (its twin does not exist), `qrcode` reads typed
only through its `@types/qrcode` twin, `ws` bundles no declarations
and has a twin, `yahoo-finance2` ships its own declarations. The
installed versions are read off the packages the install landed, and
a name never installed answers `missing`. A lock memo needs a lock
cache directory beside the workspace. The workspace is an ESM package
(`"type": "module"`), as every generated agent's is.


## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
