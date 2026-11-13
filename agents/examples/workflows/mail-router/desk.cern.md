# Mail router desk

Type: worker

Uses:

- examples/workflows/mail-router
- connectors/email
- cernanto/config

Follow the company's mailbox: the account the configuration names
under `account`, the default account when it names none,
on the plane's mail provider, with the sandbox inbox, `examples/sandbox/inbox`, as the fallback when the plane binds none. Begin with the mails of the last
day, then hand every mail that arrives to the mail router, one after
the other, missing nothing that arrives while one is handled; a mail
the router fails on is noted and passed over. Keep
following for as long as you run.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
