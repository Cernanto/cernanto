# @cernanto/runtime

The runtime of [Cernanto](https://cernanto.com), a programming language for AI agents and workflows: what runs an agent's package as one process on a plane.

**On a laptop you do not install this package yourself.** The cli, [`cernanto`](https://www.npmjs.com/package/cernanto), installs the runtime of its own version the first time you run `cernanto dev`, and starts the plane on it. Start there:

```sh
npm install -g cernanto
cernanto dev
```

## What is in it

- **The block**, `cernanto-agent`: one command that takes an agent's package and runs it as a process, a copy on a plane or a package by itself.
- **The materialize**: what turns a package into the directory a process boots from.
- **For a plane on servers**: the host's launcher `cernanto-host`, the release chooser `cernanto-release`, and the systemd unit as a template.
- **`platform-release.json`**: the list of the platform's agents of this version, each by its digest. The packages themselves are in the Cernanto registry, like any agent's, and an install pulls them and holds each to this list.
- **`release.json`**: the release's facts, among them the Node this release runs on.

Each command says its forms on `--help`.

## When you install it yourself

To run a plane on Linux servers, one or many. npm lays the runtime and the cli of one version into a folder of the release's own, and `install-release`, a program of the cli, completes the release: it pulls the platform's packages, lays the release's own Node, and lays the release folder a host runs from.

```sh
V=<version>
npm install --prefix /opt/cernanto/npm/$V cernanto@$V @cernanto/runtime@$V
node /opt/cernanto/npm/$V/node_modules/cernanto/dist/install-release.js /opt/cernanto/npm/$V /opt/cernanto/releases/$V
```

The operator's guide is the complete procedure: [Running a plane on servers](https://github.com/cernanto/cernanto/blob/main/docs/RUNNING-A-PLANE.md).

## Versions

A release is one version on three things: the cli, this runtime and the platform's agents. The cli installs the runtime of exactly its own version, and a server installs the two at the same version. Pin the version: every server of a plane runs the same release, and a plane moves to the next one by a new release folder, never by `npm update`.

It needs Node.js 26 or later, on macOS, Linux or Windows; a plane on servers runs on Linux.

## License

Business Source License 1.1, source-available. It is free on your own machines, one or many, for production use at any size. The one thing you may not do is offer a commercial service that lets third parties compile, deploy or run agents by means of the engine, above the revenue threshold the license states. Each release converts to the Apache License, Version 2.0 four years after it ships. The full text is in this package's `LICENSE` file, and the repository's [LICENSE](https://github.com/cernanto/cernanto/blob/main/LICENSE) is the map.
