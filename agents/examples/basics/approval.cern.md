# Approval

A service. Accept an approval request with a name and a time limit in
minutes. Wait for a person to approve or reject it by name, then
answer their decision. If the time limit passes first, answer that no one decided
in time. A decision for a name no request is waiting under is ignored,
and a decision settles the earliest waiting request of its name; another request
under the same name waits for a decision of its own.

Type: service

## License

Copyright: 2026 Cernanto

License: Apache-2.0
