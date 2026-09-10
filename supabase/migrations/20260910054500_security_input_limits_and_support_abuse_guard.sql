create unique index if not exists customer_support_one_open_request_per_user_idx
on public.customer_support_requests(user_id)
where user_id is not null and status in ('pending','accepted');

alter table public.customer_support_requests
  add constraint customer_support_requests_length_check check (
    char_length(btrim(customer_name)) between 1 and 100 and
    char_length(btrim(customer_phone)) between 6 and 20 and
    (customer_email is null or char_length(customer_email) <= 254) and
    char_length(btrim(issue)) between 1 and 2000
  );

alter table public.customer_support_messages
  add constraint customer_support_messages_length_check check (
    char_length(btrim(message)) between 1 and 4000
  );

alter table public.customer_addresses
  add constraint customer_addresses_length_check check (
    char_length(btrim(label)) between 1 and 50 and
    char_length(btrim(full_name)) between 1 and 100 and
    char_length(btrim(phone)) between 6 and 20 and
    char_length(btrim(address_line1)) between 1 and 200 and
    (address_line2 is null or char_length(address_line2) <= 200) and
    char_length(btrim(city)) between 1 and 100 and
    char_length(btrim(state)) between 1 and 100 and
    char_length(btrim(postal_code)) between 3 and 20 and
    char_length(btrim(country)) between 2 and 100
  );

alter table public.profiles
  add constraint profiles_user_input_length_check check (
    (full_name is null or char_length(full_name) <= 100) and
    (phone is null or char_length(phone) <= 20)
  );
