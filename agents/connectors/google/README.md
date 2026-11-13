# Google

Two agents share one sign-in. `connectors/google/client` is the module
every Google connector links: given the scopes a connector needs and
optionally an account name, it answers an access token for that Google
account, the address it signed in with and the project it was set up
with, and keeps the account signed in. `connectors/google/gmail`
implements `connectors/email` on a Gmail mailbox through it: send,
reply, wait for mail by Gmail's push, the account's own address, a
search, a mail by its Message-ID.

## Connect

The client asks once, on the first call of any Google connector, for a
Google Cloud project's OAuth client, in the terminal that made the
call and under `cernanto auth list`, with these steps:

1. Open https://console.cloud.google.com/projectcreate and sign in.
   Create a new project (or pick an existing one from the project
   picker at the top) and note its project id, shown under the project
   name.
2. With that project selected, open
   https://console.cloud.google.com/apis/library and enable each of
   these APIs: Gmail API, Google Calendar API, Google Sheets API and
   Cloud Pub/Sub API (search for its name, open it, press Enable).
3. Open https://console.cloud.google.com/apis/credentials/consent and
   set up the consent screen: choose User type External, fill in an
   app name and your email address, and save. Leave the publishing
   status as Testing.
4. On the same consent screen, open Test users (Audience) and add, as
   test users, every Google account that will sign in through this
   connector.
5. Open https://console.cloud.google.com/apis/credentials, press
   Create credentials, choose OAuth client ID, pick the application
   type Desktop app, give it a name and press Create. Copy the client
   id and the client secret it shows.
6. Paste the client id, the client secret and the project id from
   step 1 into the fields the ask shows.

Answer the ask where it printed, or from another terminal:

```
$ cernanto auth login connectors/google/client
```

Then the browser: the client asks for the authorization with a url to
open, sign in as the Google account, and allow the access. While the
app's publishing status is Testing, Google shows a warning that the
app is unverified (open Advanced, then continue), and forgets the
sign-in after seven days, so the ask comes back weekly; publishing the
app on the consent screen keeps the sign-in.

A named account is a second Google account signed in under that name
through the same OAuth client: the invoice desk's billing mailbox is
`billing`:

```
$ cernanto auth login connectors/google/client billing
```

`cernanto auth list` shows every Google account under the
client's id. The default account, the one logged in without a name,
signs in first and must have access to the project: Gmail's push
needs a Pub/Sub topic in it, which the connector makes with that
account.

## Verify it

The client's own tests sign the default account in once, for every
scope the client serves, so the browser opens once and a connector's
later ask is already granted. A compile's tests sign in as the agent
they test, so the account they connect is the client's own and a
later compile asks nothing:

```
$ cernanto deploy connectors/google/client
```

The Gmail connector's tests need one Google account, the default, a
test user of the consent screen; no fixture, since the connector
answers the account's own address, and no further sign-in once the
client's compile connected it. The scenario has the account write to
itself: a mail with an attachment, a reply in the thread, a wait from
a position, a batch and the agent a mail names:

```
$ cernanto deploy connectors/google/gmail
```

The first wait registers the push: the topic `cernanto-gmail-push` in
the project, Gmail granted the right to publish to it, a push
subscription from it to the connector's own url, and a watch on each
mailbox, renewed by a wait that finds it older than a day. A wait reads the mailbox again whenever a push
arrives and every thirty seconds regardless, so where the push cannot
be set up (an account without access to the project) the wait still
answers, later.

## Use it

```
$ cernanto call connectors/google/gmail send to:='["someone@example.com"]' subject="Hello" text="From the plane"
$ cernanto call connectors/google/gmail waitForMail from=someone@example.com timeoutMs:=120000
$ cernanto call connectors/google/gmail waitForMail account=billing hasAttachment:=true
```

A desk grants `connectors/email` and binds Gmail by the setting
`connectors/email/default`, naming its mailbox under `examples/workflows/invoice-approval/email`;
`examples/workflows/invoice-approval/README.md` shows the one-account and the
two-account setups.
