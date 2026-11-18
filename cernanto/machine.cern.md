# cernanto/machine

Type: module

Uses: npm:fs-extra

The machine a copy runs on, as the platform's agents reach it: the
node the plane runs on, npm's command under that node, the basics of
a child's environment, and a link. Each is answered one way on every
system: read from the block's mark in this copy's working folder,
from a short-lived command that ends with the call, or made with the
file system's own calls and the filesystem package it grants. Where
two systems differ, it tries the call and goes by what is there, and
it asks no system its name.

THE NODE is the folder of the node the plane runs on, as the block's
mark names it: read the mark, the file `materialized.json` in this
copy's working folder, with the file system's own read, once at the
first call that needs it and kept for the life of the process, and
take the `node` entry of its `machine` object (`machine.node`), a
non-empty text; null when the mark cannot be read or names none.

THE NODE'S PROGRAM is the file `node.exe` in THE NODE's folder when
that file exists and the file `node` in it otherwise; the program
`node`, found by its name, when THE NODE is null.

THE NPM COMMAND for given arguments, the file to run and its
arguments: THE NODE'S PROGRAM with npm's own entry script as its first
argument and the arguments as given after it. The script is the first
of these three files that exists: `node_modules/npm/bin/npm-cli.js`
in THE NODE's folder, `lib/node_modules/npm/bin/npm-cli.js` under
that folder's parent, and
`libexec/lib/node_modules/npm/bin/npm-cli.js` under that folder's
parent. When THE NODE is null or none of the three exists, npm is run
by its name: where THE BASICS name a command interpreter (the
variable `ComSpec`, found whatever the case its name is spelled in),
that program with the arguments `/d`, `/c` and `npm` and the
arguments as given after them; the program `npm` with the arguments
as given otherwise.

THE BASICS of a child's environment, a map of names to values, are
this process's environment as THE NODE'S PROGRAM prints it: run with
the argument `-e` and a program of one line that writes
`JSON.stringify(process.env)` to its standard output, started with
the child process module directly and hidden, so that no window opens
for it on any system, and given twenty seconds, a run that fails or
prints no JSON object being an error in words. A RUN THAT A SIGNAL
ENDED before its twenty seconds were over was stopped with the call
that asked for it, whose commands the plane ends with it: that is no
failure of the machine, and it fails retryable (an error whose `kind`
is `retryable`) with exactly `the command was stopped with its call`.
Of that environment, the variables `PATH`, `HOME`, `TMPDIR`,
`TMP`, `TEMP`, `USER`, `LOGNAME`, `LANG`, `LC_ALL`,
`NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `HTTP_PROXY`, `HTTPS_PROXY`,
`NO_PROXY`, `SystemRoot`, `windir`, `SystemDrive`, `ComSpec`,
`PATHEXT`, `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`,
`LOCALAPPDATA`, `ProgramData`, `ProgramFiles`, `USERNAME`,
`NUMBER_OF_PROCESSORS` and `PROCESSOR_ARCHITECTURE`, matched without
regard to case and kept under the name the environment spells, each
present in the map when the environment has it with a value that is
not empty; and `HOME` and `TMPDIR`, each always under that exact name
when it can be told: the environment's own value when it has the
variable, and otherwise `USERPROFILE`'s value for `HOME` and `TEMP`'s
for `TMPDIR`, when the environment has those.

A LINK, given a target path, a link path and whether the target is a
directory: a previous entry at the link path is removed first. For a
directory, the file system's own symbolic link of the type `junction`
at the link path, the target text exactly as given: where the system
makes a symbolic link for every account, that is a symbolic link
whose relative target stays relative, and where it does not, it is a
junction, whose relative target the system reads against the link
path's parent folder. For a file, a symbolic link at the link path,
the target text exactly as given; when the system refuses this
account the link (the error's code is `EPERM`), a copy of the file at
the link path, a relative target read against the link path's parent
folder.

## Tests

Uses: npm:fs-extra

The tests run on the live plane of this module's own machine. THE
NODE is a folder that holds a node program; THE NPM COMMAND for
`--version`, run, prints a version of digits and dots; THE BASICS
hold a `PATH` and a `HOME` that are not empty, and no name whose
value is empty. They make their links in a temporary folder of their
own with the granted filesystem package and remove it after: a link
to a directory, through which a file of the directory reads; a link
to a file, through which the file's text reads; and a second link at
the same link path to another target, which reads the other. They
touch nothing of the plane.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
