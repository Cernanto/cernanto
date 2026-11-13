# cernanto/machine/windows

Type: module

Implements: cernanto/machine
Uses: npm:fs-extra

The machine for Windows, measured and used by spawning the system's
own tools, short-lived commands that end with the call, by the
block's mark in this copy's working folder, and by the filesystem
package it grants.

THE SYSTEM is `windows`.

THE TABLE is the system's list of its processes, read by one
PowerShell command, spelled exactly
`powershell.exe -NoProfile -NonInteractive -Command "$PID; Get-CimInstance Win32_Process | ForEach-Object { '{0},{1},{2},{3},{4}' -f $_.ProcessId,$_.ParentProcessId,$_.WorkingSetSize,($_.KernelModeTime+$_.UserModeTime),$(if($_.CreationDate){$_.CreationDate.ToFileTimeUtc()}else{0}) }"`,
whose first line is the pid of the reading command itself and whose
every other line is one process as five numbers: the pid, the parent
pid, the working set in bytes, the processor time in units of a
hundred nanoseconds and the creation moment as a UTC file time, 0 for
a process the system names no moment for. A START is that creation
moment as its text, the digits as printed, which is the text the
block's launcher writes on a copy's record; a file time is larger
than a number holds exactly, so two starts are the same when their
texts are equal, and one is earlier than another as big integers
compare. A PROCESS'S CHILDREN are the rows whose parent pid is its pid
and whose start is a moment at or after its own: the system keeps an
ended parent's pid on its children and gives that pid to a later
process, so a child is told by its parent's pid and the order of the
two starts together, and a row whose start is 0 is left out. A read
costs half a second, so the reads are shared, one at a time: a read
asked while one runs waits for that one to end and takes the one read
made after it, together with every other read asked meanwhile, so
each asker has a read that began after it asked.

THE TREES: one read of the table for all the pids given, walked from
each pid through its children and theirs, in the order found, the
reading command and what it started left out of every tree: the
process's start; the pids, the process first; the processor time as
the tree's summed, in seconds, its units over ten million; and the
memory as the working sets summed, in mebibytes rounded down; nothing
for a pid the table holds no row for.

THIS BOOT'S IDENTITY is the word `windows`: a process's start alone
tells one boot's process from another's here.

WHAT A LAUNCH LEFT is found by descent, since this system shows no
process's environment: from one read of the table, the children of
the pid given, taken as the process whose start is the start given,
and theirs in turn, each answered as its pid. The descent is made
while the pid given is free or is still that process by its start;
when the table shows another start at that pid, the system gave the
pid to another process, and the answer is empty, as it is when the
start given is empty. The word and the asker's pid are left unread
here.

THE PROCESSES WORKING UNDER a folder: none, whatever the folder and
the text, since this system tells no process's working folder.

THE NODE is the folder of the node the plane runs on, as the block's
mark names it: read the mark, the file `materialized.json` in this
copy's working folder, with the file system's own read, once at the
first call that needs it and kept for the life of the process, and
take the `node` entry of its `machine` object (`machine.node`), a
non-empty text; null when the mark cannot be read or names none.

THE IMPLEMENTOR is `cernanto/machine/windows`.

THE NPM COMMAND: `node_modules\npm\bin\npm-cli.js` beside the node
the plane runs on, whose folder is THE NODE: the file `node.exe` in
that folder, with the script as its first argument and the arguments
as given after it; `cmd.exe` with the arguments `/d /c npm` and the
arguments as given after them when THE NODE is null or the script does
not exist there.

THE BASICS: this process's environment is read from one
`cmd.exe /d /u /c set`, whose output is read as UTF-16, little-endian,
and whose every line is one variable as
`NAME=value`; of those lines, the variables `PATH`, `SystemRoot`,
`windir`, `SystemDrive`, `ComSpec`, `PATHEXT`, `TEMP`, `TMP`,
`USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `APPDATA`, `LOCALAPPDATA`,
`ProgramData`, `ProgramFiles`, `USERNAME`, `NUMBER_OF_PROCESSORS`,
`PROCESSOR_ARCHITECTURE`, `NODE_EXTRA_CA_CERTS`, `SSL_CERT_FILE`,
`HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`, matched without regard to
case and kept under the name the line spells, each present in the
map when the listing has it; and `HOME` and `TMPDIR`, each always
under that exact name: the listing's own value when it has the
variable with a value (a shell that came through ssh or Git Bash sets
them), and otherwise `USERPROFILE`'s value for `HOME` and `TEMP`'s for
`TMPDIR`, when the listing has those.

A LINK: for a directory target, a junction at the link path whose
target is the target made absolute against the link path's parent
folder; for a file target, a copy of the file (a relative target read
against that same parent folder) at the link path; a previous entry
at the link path is removed first.

THE TOOLBOX: the folder given, made when absent, laid out as a root
of its own. `usr\bin` under it holds one copy per program of the list
that Git for Windows carries: each `<name>.exe` from `usr\bin` of the
Git for Windows install, copied under its own name with the install's
modification time kept, when the folder lacks it or when its size or
its modification time differs from the install's, and every
`msys-*.dll` of that `usr\bin` copied beside them the same way.
The install's root is the folder two above the `git.exe` found in the
folders of this process's own `PATH`, as THE BASICS read it, else
`C:\Program Files\Git`. `usr\share\misc\magic.mgc` is copied
from the install's own, the same way, when the list names `file`,
which reads it. `tmp` is made beside `usr`, and `etc` beside it
holding `fstab` with the one line
`none / cygdrive binary,posix=0,noacl,user 0 0`. A copy named for a
program the list lacks is deleted,
and a program Git for Windows lacks is skipped. The answer is the
real path of that `usr\bin` folder. A machine without Git for Windows
answers the folder's `usr\bin`, made and empty.

## Tests

Uses: npm:fs-extra

The tests run on a live Windows plane, on a machine with Git for
Windows. They measure the system's own process,
pid 4, which every Windows machine runs, whose tree names that pid
first and a start of digits; this boot's identity is the word
`windows`; a launch whose pid no process has leaves nothing behind;
and no process works under the tests' own folder. They make their junction and
their copy in a folder of their own under the working folder, with
the granted filesystem package, and remove it after. They make a
toolbox in that folder for `bash`, `ls`, `cat`, `file` and a program
no machine has, and find the four copies with the runtime's libraries
beside them, the magic file, `tmp`, and `etc\fstab` with its one
line; and a second toolbox in the same folder for the list without
`cat` holds no copy of it. The toolbox is proven by its layout alone;
a session's shell is where its programs run. The tests leave the
plane as it is.

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
