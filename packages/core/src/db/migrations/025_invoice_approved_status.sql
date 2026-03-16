-- Migration 025: Add 'approved' status to invoices
-- An approved invoice has its AR journal entry posted but has NOT been emailed.
-- 'sent' means the invoice PDF was actually delivered to the customer.

-- Drop and recreate the CHECK constraint to include 'approved'.
-- PostgreSQL: ALTER TABLE + DROP/ADD CONSTRAINT
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN (
    'draft', 'approved', 'sent', 'viewed', 'paid',
    'partially_paid', 'overdue', 'void'
  ));
