# Google Client

Type: module

Uses:

- cernanto/auth
- npm:googleapis@^182

The one Google sign-in every Google connector shares. Given the scopes
a connector needs and optionally an account name, answer an access
token for that Google account, the default one or the one connected
under that name, good for at least a minute, with the address the
account signed in with and the project id it was set up with. The
account is a Google Cloud project's OAuth client of the desktop kind,
asked for once under the provider `google.com` as its client id, its
client secret and the project's id: a project with the Gmail, Google
Calendar, Google Sheets and Cloud Pub/Sub APIs enabled, and a consent
screen of an external app in testing whose test users are every
Google account that will sign in; every account, the default and the
named ones, uses that one client, asked for once for all of them. Then sign the account in through the browser for
the scopes asked, keep it signed in from then on without asking again,
and, when a connector asks for a scope the account has not granted,
sign in again for every scope asked so far. The token is a secret:
never record it, never log it.

## Tests

The tests sign the account in once, for every scope this client
serves at once: reading, sending and modifying mail, Pub/Sub,
Calendar and Sheets, so a connector's later ask within them is already
granted; a second ask within those scopes answers without the browser
and the same account.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
