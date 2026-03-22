-- Drop optional ledger table only (append-only mirror of PAYMENT/SETTLEMENT); core tables unchanged for existing app code.
DROP TABLE IF EXISTS `FINANCIAL_LEDGER_ENTRY`;