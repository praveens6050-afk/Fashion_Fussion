revoke all privileges on all tables in schema public from anon, authenticated;
revoke all privileges on all sequences in schema public from anon, authenticated;

-- The reconstructed local baseline does not create every production table.
-- Re-apply the explicit allowlist only for relations that exist in this database.
do $narrow_client_table_grants$
declare
  item record;
begin
  for item in
    select * from (values
      ('products', 'select', 'anon'),
      ('products', 'select, insert, update, delete', 'authenticated'),
      ('profiles', 'select, insert, update', 'authenticated'),
      ('customer_addresses', 'select, insert, update, delete', 'authenticated'),
      ('customer_support_requests', 'select, insert, update', 'authenticated'),
      ('customer_support_messages', 'select, insert', 'authenticated'),
      ('customer_wishlist', 'select, insert, delete', 'authenticated'),
      ('coupons', 'select, insert, update, delete', 'authenticated'),
      ('gift_cards', 'select, insert, update, delete', 'authenticated'),
      ('gift_card_codes', 'select, insert, update, delete', 'authenticated'),
      ('coupon_redemptions', 'select', 'authenticated'),
      ('gift_card_redemptions', 'select', 'authenticated'),
      ('orders', 'select, update', 'authenticated')
    ) as allowlist(table_name, privileges, grantee)
  loop
    if to_regclass(format('public.%I', item.table_name)) is not null then
      execute format('grant %s on table public.%I to %I',
        item.privileges, item.table_name, item.grantee);
    end if;
  end loop;
end
$narrow_client_table_grants$;

-- Sequence grants are likewise conditional because serial sequences are not
-- guaranteed to exist in a minimal/reconstructed baseline.
do $narrow_client_sequence_grants$
declare
  sequence_name text;
begin
  foreach sequence_name in array array[
    'products_id_seq',
    'customer_addresses_id_seq',
    'customer_support_requests_id_seq',
    'customer_support_messages_id_seq',
    'customer_wishlist_id_seq',
    'coupons_id_seq',
    'gift_cards_id_seq',
    'gift_card_codes_id_seq'
  ]
  loop
    if to_regclass(format('public.%I', sequence_name)) is not null then
      execute format('grant usage on sequence public.%I to authenticated', sequence_name);
    end if;
  end loop;
end
$narrow_client_sequence_grants$;
