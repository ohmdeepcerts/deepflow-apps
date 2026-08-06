# Certificate form — remaining missing columns

Same root cause as the `agent` column: the "Add / Edit Certificate" form has
fields (Email, Phone, "Mark as No Response") that were added to the UI at
some point but never got matching columns on the `certs` table. Each save
attempt only reveals the *next* missing one, one at a time — to stop that
back-and-forth, run all of these together:

```sql
ALTER TABLE certs ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE certs ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE certs ADD COLUMN IF NOT EXISTS notresponding boolean;
```

I also fixed a related bug on my end: the "No Response" checkbox was sending
its value as `notResponding` (camelCase) instead of `notresponding`, which
would have 400'd even after you added the column. That's fixed in `index.html`
now, so the checkbox will actually save correctly once you deploy.

If saving still 400s with "Could not find the 'X' column" after this, send
me the exact field name and I'll add it here too — but this should cover
everything the current form sends.
