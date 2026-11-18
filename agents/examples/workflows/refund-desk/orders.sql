-- The shop of the fictional company, for the refund desk's real form:
-- the sandbox orders store's rows as PostgreSQL tables. Load it into a
-- free Neon or Supabase database:
--   psql "$DATABASE_URL" -f workflows/refund-desk/orders.sql
-- In the real world payment_id holds the Stripe payment the order paid
-- with (a test-mode payment intent id, pi_...); the sandbox's ids are
-- placeholders to replace.

CREATE TABLE IF NOT EXISTS orders (
  order_id text PRIMARY KEY,
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  placed_at date NOT NULL,
  delivered_at date,
  status text NOT NULL,
  items text NOT NULL,
  total numeric(12, 2) NOT NULL,
  currency text NOT NULL,
  payment_id text NOT NULL,
  payment_status text NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  invoice_id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES orders (order_id),
  issued_at date NOT NULL,
  due_at date NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL,
  paid_at date
);

-- The refunds made, one per order: the desk records the refund Stripe
-- made under the order id, its key.
CREATE TABLE IF NOT EXISTS refunds (
  order_id text PRIMARY KEY REFERENCES orders (order_id),
  refund_id text NOT NULL,
  amount numeric(12, 2) NOT NULL,
  currency text NOT NULL,
  refunded_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO orders VALUES ('A-1001', 'Lena Fischer', 'lena.fischer@example.com', '2026-07-02', '2026-07-06', 'delivered', 'Ledger notebook x2;Fountain pen x1', 74.00, 'EUR', 'pay_9001', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1002', 'Tomas Lind', 'tomas.lind@example.se', '2026-07-19', '2026-07-24', 'delivered', 'Desk pad (green) x1', 29.00, 'EUR', 'pay_9002', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1003', 'Lena Fischer', 'lena.fischer@example.com', '2026-08-11', '2026-08-14', 'delivered', 'Ledger notebook x10', 290.00, 'EUR', 'pay_9003', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1004', 'Maren Vogt', 'maren.vogt@example.de', '2026-08-20', '2026-08-25', 'delivered', 'Fountain pen x1;Ink bottle x2', 63.00, 'EUR', 'pay_9004', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1005', 'Piet de Vries', 'piet.devries@example.nl', '2026-09-01', '2026-09-04', 'delivered', 'Desk pad (grey) x2', 58.00, 'EUR', 'pay_9005', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1006', 'Sofia Rossi', 'sofia.rossi@example.it', '2026-09-08', NULL, 'exception', 'Ledger notebook x3', 87.00, 'EUR', 'pay_9006', 'failed') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1007', 'Grace Mueller', 'grace.mueller@example.net', '2026-09-18', '2026-09-22', 'delivered', 'Desk pad (blue) x1', 29.00, 'EUR', 'pay_9007', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1008', 'Jonas Berg', 'jonas.berg@example.org', '2026-09-19', '2026-09-23', 'delivered', 'Fountain pen x2', 84.00, 'EUR', 'pay_9008', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1009', 'Aino Korhonen', 'aino.korhonen@example.fi', '2026-09-21', NULL, 'shipped', 'Ink bottle x6', 66.00, 'EUR', 'pay_9009', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1010', 'Erik Hansen', 'erik.hansen@example.dk', '2026-09-22', NULL, 'exception', 'Ledger notebook x1;Desk pad (green) x1', 58.00, 'EUR', 'pay_9010', 'failed') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1011', 'Maren Vogt', 'maren.vogt@example.de', '2026-09-24', NULL, 'shipped', 'Ledger notebook x4', 116.00, 'EUR', 'pay_9011', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO orders VALUES ('A-1012', 'Jonas Berg', 'jonas.berg@example.org', '2026-09-23', '2026-09-25', 'delivered', 'Ledger notebook x3', 87.00, 'EUR', 'pay_9012', 'paid') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0101', 'A-1001', '2026-07-02', '2026-07-16', 74.00, 'EUR', '2026-07-02') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0102', 'A-1002', '2026-07-19', '2026-08-02', 29.00, 'EUR', '2026-07-19') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0103', 'A-1003', '2026-08-11', '2026-08-25', 290.00, 'EUR', '2026-08-11') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0104', 'A-1004', '2026-08-20', '2026-09-03', 63.00, 'EUR', '2026-08-20') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0105', 'A-1005', '2026-09-01', '2026-09-15', 58.00, 'EUR', '2026-09-01') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0106', 'A-1006', '2026-09-08', '2026-09-22', 87.00, 'EUR', NULL) ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0107', 'A-1007', '2026-09-18', '2026-10-02', 29.00, 'EUR', '2026-09-18') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0108', 'A-1008', '2026-09-19', '2026-10-03', 84.00, 'EUR', '2026-09-19') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0109', 'A-1009', '2026-09-21', '2026-10-05', 66.00, 'EUR', '2026-09-21') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0110', 'A-1010', '2026-09-22', '2026-10-06', 58.00, 'EUR', NULL) ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0111', 'A-1011', '2026-09-24', '2026-10-08', 116.00, 'EUR', '2026-09-24') ON CONFLICT DO NOTHING;
INSERT INTO invoices VALUES ('INV-2026-0112', 'A-1012', '2026-09-23', '2026-10-07', 87.00, 'EUR', '2026-09-23') ON CONFLICT DO NOTHING;
