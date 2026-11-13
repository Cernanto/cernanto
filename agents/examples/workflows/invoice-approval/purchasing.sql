-- The purchasing system of the fictional company, for the invoice
-- desk's real form: the sandbox purchasing store's rows as PostgreSQL
-- tables. Load it into a free Neon or Supabase database:
--   psql "$DATABASE_URL" -f workflows/invoice-approval/purchasing.sql

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  country text NOT NULL,
  currency text NOT NULL,
  payment_terms_days integer NOT NULL,
  iban text NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  po_id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES vendors (vendor_id),
  issued_at date NOT NULL,
  currency text NOT NULL,
  total numeric(12, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  po_id text NOT NULL REFERENCES purchase_orders (po_id),
  line integer NOT NULL,
  description text NOT NULL,
  quantity numeric(12, 2) NOT NULL,
  unit_price numeric(12, 2) NOT NULL,
  PRIMARY KEY (po_id, line)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  receipt_id text NOT NULL,
  po_id text NOT NULL REFERENCES purchase_orders (po_id),
  received_at date NOT NULL,
  line integer NOT NULL,
  quantity_received numeric(12, 2) NOT NULL,
  PRIMARY KEY (receipt_id, line)
);

-- The accounts-payable ledger: one row per posted invoice; a vendor's
-- invoice number is posted once (the desk's duplicate rule).
CREATE TABLE IF NOT EXISTS ap_ledger (
  entry_id text PRIMARY KEY,
  vendor_id text NOT NULL REFERENCES vendors (vendor_id),
  invoice_number text NOT NULL,
  po_id text REFERENCES purchase_orders (po_id),
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL,
  posted_at date NOT NULL,
  status text NOT NULL,
  UNIQUE (vendor_id, invoice_number)
);

INSERT INTO vendors VALUES ('V-100', 'Nordwind Paper GmbH', 'invoices@nordwind-paper.example', 'DE', 'EUR', 30, 'DE02120300000000202051') ON CONFLICT DO NOTHING;
INSERT INTO vendors VALUES ('V-101', 'Hafen Kaffee Roesterei', 'buchhaltung@hafenkaffee.example', 'DE', 'EUR', 14, 'DE02100500000054540402') ON CONFLICT DO NOTHING;
INSERT INTO vendors VALUES ('V-102', 'Thames Lighting Ltd', 'accounts@thameslighting.example', 'GB', 'GBP', 30, 'GB33BUKB20201555555555') ON CONFLICT DO NOTHING;
INSERT INTO vendors VALUES ('V-103', 'Berlin Buero Vermietung', 'miete@bbv.example', 'DE', 'EUR', 0, 'DE02500105170137075030') ON CONFLICT DO NOTHING;
INSERT INTO purchase_orders VALUES ('PO-1042', 'V-100', '2026-09-01', 'EUR', 6000.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_orders VALUES ('PO-1043', 'V-101', '2026-09-05', 'EUR', 1710.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_orders VALUES ('PO-1044', 'V-102', '2026-09-08', 'GBP', 820.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1042', 1, 'A4 copy paper, 80 g, box of 2500', 200, 24.50) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1042', 2, 'Toner cartridge TN-2420', 12, 89.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1042', 3, 'Delivery', 1, 32.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1043', 1, 'Espresso beans, 1 kg', 60, 28.50) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1044', 1, 'Desk lamp, LED, dimmable', 15, 54.00) ON CONFLICT DO NOTHING;
INSERT INTO purchase_order_lines VALUES ('PO-1044', 2, 'Shipping', 1, 10.00) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2201', 'PO-1042', '2026-09-12', 1, 200) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2201', 'PO-1042', '2026-09-12', 2, 12) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2201', 'PO-1042', '2026-09-12', 3, 1) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2202', 'PO-1043', '2026-09-16', 1, 60) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2203', 'PO-1044', '2026-09-19', 1, 15) ON CONFLICT DO NOTHING;
INSERT INTO goods_receipts VALUES ('GR-2203', 'PO-1044', '2026-09-19', 2, 1) ON CONFLICT DO NOTHING;
INSERT INTO ap_ledger VALUES ('AP-3001', 'V-103', 'BBV-2026-09', NULL, 2140.00, 'EUR', '2026-09-01', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO ap_ledger VALUES ('AP-3002', 'V-101', 'HK-77640', 'PO-1039', 1710.00, 'EUR', '2026-08-20', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO ap_ledger VALUES ('AP-3003', 'V-100', 'NP-2026-0388', 'PO-1037', 5820.00, 'EUR', '2026-08-14', 'paid') ON CONFLICT DO NOTHING;
