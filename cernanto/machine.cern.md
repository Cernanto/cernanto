# cernanto/machine

An interface: the system under the plane, as the platform's agents
reach it, what differs between macOS, Linux and Windows. An
implementor answers for the system it runs on. A consumer binds it with no name,
and the plane binds the implementor of the system it runs on.

The operations:

- THE SYSTEM: its name, one of `macos`, `linux` and `windows`.
- THE TREES under given pids, from one read of the system's process
  table: for each pid, the process and every descendant of it, as the
  process's start (a text, the same at every read of the same process
  and another for any other process the pid is given to), the tree's
  pids (the process first, each one before the ones it started), the
  processor time the tree used so far, summed, in seconds, and its
  memory summed in mebibytes rounded down; or nothing when the pid
  names no running process. A tool that fails or cannot be read is an
  error in words.
- THIS BOOT'S IDENTITY: a text every process of one boot of the
  machine reads the same and a restart changes; one fixed word where
  the system tells none, a process's start alone telling one boot's
  process from another's there.
- WHAT A LAUNCH LEFT: given the word a launch laid into the environment
  of every command it ran (`NAME=value`), the pid and the start of the
  process that launch started, and the asker's own pid, the processes
  those commands started that still run, as the numbers a kill ends
  them by: a process's pid, or the id of a process group negated where
  the system runs a command's processes in a group of their own, the
  asker's own group left out.
- THE PROCESSES WORKING UNDER a folder: given a folder and a text,
  every process whose command line holds the text and whose working
  folder is the folder or lies under it, each as its pid and its
  command line as the system prints it; none where the system tells
  no process's working folder.
- THE NPM COMMAND for given arguments: the file to run and its
  arguments, npm under the node the plane runs on.
- THE BASICS of a child's environment on this system: a map of names
  to values read from the implementor's own process environment, the
  variables every system's child needs and the ones this system adds;
  a name without a value is absent from the map.
- A LINK: given a target path, a link path and whether the target is a
  directory, the link made the system's way, a previous entry at the
  link path removed first.
- THE TOOLBOX for a vendor's shell: given a list of program names and a
  folder, the `PATH` value a vendor is handed, under which its shell
  finds those programs alone where the system can make such a folder.
- THE NODE: the folder of the node the plane runs on, or null when the
  machine names none.
- THE IMPLEMENTOR: the agent id of the implementor that answers.

Type: interface

## License

Copyright: 2026 Cernanto. All rights reserved.

License: BUSL-1.1
