create table if not exists public.customer_support_requests (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  customer_phone text not null,
  customer_email text,
  issue text not null,
  order_id bigint,
  status text not null default 'pending' check (status in ('pending','accepted','closed')),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_support_messages (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.customer_support_requests(id) on delete cascade,
  sender_type text not null check (sender_type in ('customer','admin')),
  sender_user_id uuid references auth.users(id) on delete set null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.customer_support_requests enable row level security;
alter table public.customer_support_messages enable row level security;

drop policy if exists "Customers can create support requests" on public.customer_support_requests;
create policy "Customers can create support requests" on public.customer_support_requests for insert to authenticated with check (user_id = auth.uid() or user_id is null);

drop policy if exists "Customers can view own support requests" on public.customer_support_requests;
create policy "Customers can view own support requests" on public.customer_support_requests for select to authenticated using (user_id = auth.uid());

drop policy if exists "Customers can update own pending support requests" on public.customer_support_requests;
create policy "Customers can update own pending support requests" on public.customer_support_requests for update to authenticated using (user_id = auth.uid() and status = 'pending') with check (user_id = auth.uid());

drop policy if exists "Customers can view own support messages" on public.customer_support_messages;
create policy "Customers can view own support messages" on public.customer_support_messages for select to authenticated using (exists (select 1 from public.customer_support_requests r where r.id = request_id and r.user_id = auth.uid()));

drop policy if exists "Customers can send support messages" on public.customer_support_messages;
create policy "Customers can send support messages" on public.customer_support_messages for insert to authenticated with check (sender_type = 'customer' and sender_user_id = auth.uid() and exists (select 1 from public.customer_support_requests r where r.id = request_id and r.user_id = auth.uid() and r.status = 'accepted'));

create index if not exists customer_support_requests_status_created_idx on public.customer_support_requests(status, created_at desc);
create index if not exists customer_support_requests_user_idx on public.customer_support_requests(user_id);
create index if not exists customer_support_messages_request_created_idx on public.customer_support_messages(request_id, created_at);
