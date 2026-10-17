drop policy if exists "Admins can view support requests" on public.customer_support_requests;
create policy "Admins can view support requests" on public.customer_support_requests for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Admins can update support requests" on public.customer_support_requests;
create policy "Admins can update support requests" on public.customer_support_requests for update to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)) with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Admins can view support messages" on public.customer_support_messages;
create policy "Admins can view support messages" on public.customer_support_messages for select to authenticated using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));

drop policy if exists "Admins can send support messages" on public.customer_support_messages;
create policy "Admins can send support messages" on public.customer_support_messages for insert to authenticated with check (sender_type = 'admin' and sender_user_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true));
