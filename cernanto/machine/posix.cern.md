# cernanto/machine/posix

Type: module

Implements: cernanto/machine
Uses: npm:fs-extra

The machine for macOS and Linux, measured and used by spawning the
system's own tools, short-lived commands that end with the call, by
the block's mark in this copy's working folder, and by the filesystem
package it grants.

THE SYSTEM is `macos` where the process runs on darwin and `linux`
where it runs on linux.

THE TREES: one `ps -ax -o pid=,ppid=,rss=,time=,lstart=` for all the
pids given, walked from each pid through every descendant by the rows'
parents, in the order found: the pids, the process first; the
processor time as the tree's `time` summed, in seconds, a `time`
printed as `[days-]hours:minutes:seconds` or as `minutes:seconds` with
a fraction; and the memory as the tree's `rss` kilobytes in mebibytes,
rounded down; nothing for a pid the table holds no row for. THE START
of a process is the text the block's launcher writes on a copy's
record: on Linux `ticks <n>`, `n` the twenty-second field of the file
`/proc/<pid>/stat`, which is the twentieth word after the line's last
`)`, read with the file system's own read, and the empty text when the
file cannot be read; on macOS the row's `lstart`, its five words
joined by single blanks.

THIS BOOT'S IDENTITY: on Linux the file
`/proc/sys/kernel/random/boot_id`, read with the file system's own
read and trimmed; on macOS what `sysctl -n kern.bootsessionuuid`
answers, trimmed; an empty answer is an error in words.

WHAT A LAUNCH LEFT is found by the word alone, which the launch's
commands carry in their environment; the pid and the start given are
left unread here. On Linux, of every pid folder of `/proc`, the file
`environ` this process can read, its words separated by NUL bytes,
read with the file system's own read: a process carries the word when
one of those words is the word whole, and its group is the third word
after the last `)` of its `stat` line. On macOS one `ps -E -axo
pid=,pgid=,command=`, which lays each process's environment into its
command line: a process carries the word when its command line holds
it between blanks, and its group is the row's second number. The
answer is the group of every process that carries the word, each group
once, negated; the group of the asker's pid, read the same way (its
own `stat` line on Linux, its row on macOS), is left out, and a
process whose files this process cannot read is passed over.

THE PROCESSES WORKING UNDER a folder: on Linux, of every pid folder of
`/proc` this process can read, the command line is the file `cmdline`
with its NUL bytes as blanks, trimmed, and the working folder the link
`cwd`, both read with the file system's own calls; on macOS one `ps -A
-o pid=,command=` names the command lines, and for each row whose
command line holds the text the working folder is what `lsof -a -d cwd
-p <pid> -Fn` names, its line that begins with `n`, without that
letter. A working folder lies under the folder given when it is that
folder's real path or begins with that path and a separator; a
process that left meanwhile is passed over.

Where every pid folder of `/proc` is read (what a launch left, the
processes working under a folder), the folders are taken thirty-two at
a time, so the files open at once stay few on a machine with many
processes.

THE NODE is the folder of the node the plane runs on, as the block's
mark names it: read the mark, the file `materialized.json` in this
copy's working folder, with the file system's own read, once at the
first call that needs it and kept for the life of the process, and
take the `node` entry of its `machine` object (`machine.node`), a
non-empty text; null when the mark cannot be read or names none.

THE IMPLEMENTOR is `cernanto/machine/posix`.

THE NPM COMMAND: npm's own entry script run under the node the plane
runs on, whose folder is THE NODE: the file `node` in that folder, with
`lib/node_modules/npm/bin/npm-cli.js` under the folder's parent as
its first argument when that file exists, else
`node_modules/npm/bin/npm-cli.js` beside the node when that exists,
and the arguments as given after the script; the command `npm` on
the `PATH` with the arguments as given when THE NODE is null or
neither file exists.

THE BASICS: `PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `USER`, `LOGNAME`,
`LANG`, `LC_ALL`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`, `HTTP_PROXY`,
`HTTPS_PROXY` and `NO_PROXY`, each in upper case and lower case, each
present in the map when set in this process's environment.

A LINK: a symbolic link at the link path, its target text exactly as
given (a relative target stays relative), for a directory and a file
alike; a previous entry at the link path is removed first.

THE TOOLBOX: the folder given, made when absent, holding one symbolic
link per program of the list that the machine has, each link named
as the program and pointing at the first of `/usr/bin` and `/bin`
that holds it, a link named for a program the list lacks deleted; the
answer is the folder's real path. The toolbox is asked for at every
turn of a coder, by several turns at once on a fresh generation, so
making it is idempotent: a link already there with the right target
is kept, and a link that another call makes at the same moment (the
system refusing the link as existing) is read as made, never as a
failure; only a link there with another target is remade.

## Tests

The tests run on the live plane of this module's own system. They
measure this process's own pid, whose tree names that pid first and a
start; they read this boot's identity twice and find one text; a word
no process carries leaves nothing behind; and this process is among
the processes working under its own working folder whose command line
holds `node`, while a fresh folder of the tests' own has none. They
make their links and their toolbox in a temporary folder of their own
and remove it after, and touch nothing of the plane. Two toolboxes asked for the same folder at the same
moment both answer it, with every link of the list in place.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
