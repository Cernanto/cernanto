# Purchasing

Type: service

Uses: file:purchasing/data/

Purchase orders, goods receipts, vendors and the accounts payable
ledger, seeded from the granted files. Answer a purchase order by its
id with its vendor, its currency, its total and its lines; the goods
receipts of a purchase order, with what was received per line; a
vendor by its id or by its name; and the ledger's entries. Post an
invoice to the ledger: its vendor, its number, its purchase order, its
amount and its currency, posted as given, with no check of its
vendor, its purchase order, its amount or its currency; answer the
entry. The same invoice number of
the same vendor is posted once: a second post answers the first entry.
Answer the sample invoice documents by name, as the bytes of a PDF, so
a test can deliver one the way a vendor would.

## License

Copyright: 2026 Cernanto

License: Apache-2.0
