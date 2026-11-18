# HubSpot

Uses:

- openapi:https://api.hubspot.com/public/api/spec/v2/specs/release/22154/version/3

The company's HubSpot CRM, reached through HubSpot's objects API on
the company's HubSpot account; a named account is a second HubSpot
account connected under that name. Given an email address, answer the contact that has it, with its
id, first and last name, email, phone and company, or null when none
has it. Given a contact's email, first and last name, and optionally a
phone and a company, create the contact, or update the one that
already has that email, and answer it as found; an update that gives
no phone or company leaves the stored ones as they were. Given a deal's name,
its amount, the stage it is in and optionally the id of the contact it
belongs to, create the deal in the default pipeline and answer its id,
name, amount and stage. Remove a contact by its id and answer whether
it was there.

## Tests

The contacts the tests make carry addresses under the domain
`example.com` that name the test and are removed at the end; a deal
the tests make is in the default pipeline's first stage,
`appointmentscheduled`, and stays.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
