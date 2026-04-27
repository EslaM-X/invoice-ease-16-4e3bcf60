WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS new_no
  FROM public.invoices
)
UPDATE public.invoices i
SET receipt_number = o.new_no,
    invoice_number = 'INV-' || to_char(i.created_at, 'YYYY') || '-' || lpad(o.new_no::text, 5, '0')
FROM ordered o
WHERE i.id = o.id;

UPDATE public.company_counters
SET receipt_seq = COALESCE((SELECT MAX(receipt_number) FROM public.invoices), 0),
    updated_at = now()
WHERE id = 'default';