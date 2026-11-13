# Slack

`connectors/slack` implements `connectors/chat` on a Slack workspace: a
desk that posts on the sandbox chat today posts on Slack by one
setting, `connectors/chat/default`. The account is a Slack app you create; the
connector receives messages through Slack's Events API at its own url
and reads the workspace's history for what came before a wait's
position.

## Connect

Nothing is set up in advance: the first call that needs the account
asks for it, in the terminal that made the call (a deploy, an invoke,
a `trace -f`) and under `cernanto auth list`, with these steps,
the request url filled in for your plane:

1. Open https://api.slack.com/apps and sign in to your workspace, click
   "Create New App", choose "From scratch", name it and pick your
   workspace.
2. Open "OAuth & Permissions", and under "Bot Token Scopes" add:
   channels:history, groups:history, im:history, mpim:history,
   channels:read, groups:read, im:read, mpim:read, chat:write,
   app_mentions:read, users:read, reactions:write.
3. Open "Event Subscriptions", switch "Enable Events" on, and paste the
   url the ask prints as the Request URL (Slack shows it as Verified).
4. Still under Event Subscriptions, open "Subscribe to bot events" and
   add: message.channels, message.groups, message.im, message.mpim,
   app_mention. Save the changes.
5. Open "App Home" and, under "Show Tabs", switch on the Messages Tab
   and tick "Allow users to send Slash commands and messages from the
   messages tab".
6. Open "Install App" (or "OAuth & Permissions"), click "Install to
   Workspace", allow it, and copy the "Bot User OAuth Token" (it starts
   with xoxb-).
7. Open "Basic Information", and under "App Credentials" click Show
   beside "Signing Secret" and copy it.
8. Paste the bot token and the signing secret into the fields the ask
   shows.
9. Once in Slack, invite the bot to every channel it should read or
   post in: open the channel and type /invite @YourAppName.

Answer the ask where it printed, or from another terminal:

```
$ cernanto auth login connectors/slack
```

The url of step 3 is verified while the connector is running a call,
which it is while it asks, so paste it during the ask.

## Verify it

The connector's own tests need one app in the workspace, invited to
one channel, whose id the tests read from the configuration:

```
$ cernanto config connectors/slack/tests chat=C0123ABCDEF
$ cernanto deploy connectors/slack
```

The setting is the channel's id, never its name: Slack takes a name
where a message is posted and nowhere else. Slack shows the id at the
bottom of the channel's About tab, and the last part of the channel's
link is the same id.

The deploy runs the tests live: the first call asks for the account,
and the scenario runs in the channel with the app posting to itself: a
post, a mention, a reply under a thread, a wait from a position, a
batch, a reaction. The login is kept for every later call; `cernanto auth list` shows it under `connectors/slack`.

```
$ cernanto auth login connectors/slack tester
```

## Use it

```
$ cernanto call connectors/slack listChannels
$ cernanto call connectors/slack send chat=C0123ABCDEF text="Hello from the plane"
$ cernanto call connectors/slack waitForMessage chat=C0123ABCDEF mentioned:=true timeoutMs:=60000
```

A desk grants `connectors/chat` and binds this connector by the
setting `connectors/chat/default`; `examples/workflows/support-follow-up/README.md` and
`examples/workflows/helpdesk/README.md` show the switch.
