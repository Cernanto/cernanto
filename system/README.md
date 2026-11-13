# @cernanto/system

The system under the cli and the runtime: what differs between macOS,
Linux and Windows, and nothing else. One contract, two implementations
(posix, windows), the choice made once at import. The only file in the
tree that reads `process.platform` is `src/index.ts`.
