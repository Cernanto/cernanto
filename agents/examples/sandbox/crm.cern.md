# CRM

Type: service

Uses: file:crm/data/

Leads, tickets, contacts and contracts, seeded from the granted files.
Take a new lead (a company, a contact's name and email, a website and
a country) and answer it with its id; answer a lead by its id; assign
a lead to an owner; record what was learned about a lead, its employee
count, its industry, its fit tier and a two-line summary, and answer
them with the lead from then on; wait for the next new lead, for as
long as it takes. Take a new ticket (the requester's email, a subject
and a body) and answer it with its id; answer a ticket by its id, with
the responses recorded on it so far; set a ticket's category and team;
wait for the next new ticket, for as long as it takes. Record a
response on a ticket, who responded and what they said, and wait for
the next response on a given ticket for up to a given time, answering
the response or null when the time passes. Answer a contact by email.
Answer a contract by its id, and the contracts ending within a given
number of days, from today through that many days ahead, both days
included and none already ended, soonest first; a contract carries the price its owner
targets for its renewal and, once decided, the outcome of the renewal.
Record a contract's renewal outcome: renewed at a price, declined, or
no answer.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
