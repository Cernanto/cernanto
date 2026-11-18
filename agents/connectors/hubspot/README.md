# HubSpot

`connectors/hubspot` reads and writes contacts and deals in a HubSpot
CRM through HubSpot's own objects API, granted as its OpenAPI document
at HubSpot's url: the tree's example of the openapi lane signed in.
The document declares OAuth 2.0, and the connector is reached the way
integrations reach HubSpot unattended, with a key of the account
sent as a bearer token; the lane's ask takes that key in place of an
OAuth client, and no browser flow runs.

## Connect

Nothing is set up in advance: the first call asks for the account, in
the terminal that made the call and under `cernanto auth list`,
with the page to open and the steps the compile found in HubSpot's own
documentation. The ask has three fields, a token and an OAuth client's
id and secret; paste the key and leave the client fields empty. As
HubSpot documents it today (a service key; HubSpot retires the older
private apps in the autumn of 2026, and an existing private app's
access token works the same way):

1. Sign in to HubSpot as a super admin, or as a user with the
   Developer tools access permission, and open Development, then
   Keys, then Service keys.
2. Click "Create service key" and give it a name.
3. Click "Add new scope" and tick crm.objects.contacts.read,
   crm.objects.contacts.write, crm.objects.deals.read and
   crm.objects.deals.write, then create the key and confirm.
4. On the key's page click "Show", then "Copy" (the key starts with
   pat-).

Answer the ask where it printed, or from another terminal:

```
$ cernanto auth login connectors/hubspot api.hubapi.com
```

A key HubSpot refuses is asked for again with HubSpot's words. A
free HubSpot CRM is enough.

## Verify it

The connector's own tests need one account and no fixture: they make
contacts under `example.com` addresses that name the test, find and
update them, make a deal in the default pipeline's first stage, and
remove the contacts at the end.

```
$ cernanto deploy connectors/hubspot
```

## Use it

`cernanto contract connectors/hubspot` prints the functions the
compile wrote and what each takes: a contact by email, a contact created
or updated, a deal created, a contact removed. The lead desk and the
renewal desk (phase one) grant it as the CRM behind their real forms.
