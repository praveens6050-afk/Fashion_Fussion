-- When a customer starts the same still-open support topic again, append the new
-- message to the existing conversation instead of silently returning the ticket.
create or replace function public.create_support_ticket(p_channel text,p_order_id bigint,p_product_id bigint,p_variant_id bigint,p_issue_type text,p_subject text,p_message text)
returns public.support_tickets language plpgsql security definer set search_path='pg_catalog','public'
as $function$
declare v_uid uuid:=auth.uid(); v_order public.orders; v_seller uuid; v_ticket public.support_tickets; v_existing public.support_tickets;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if p_channel not in ('customer_support','seller_support') then raise exception 'Invalid support channel'; end if;
  if char_length(btrim(coalesce(p_issue_type,''))) not between 2 and 80 then raise exception 'Issue type is required'; end if;
  if char_length(btrim(coalesce(p_subject,''))) not between 3 and 180 then raise exception 'Subject must be 3 to 180 characters'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 5000 then raise exception 'Message is required'; end if;
  if not public.consume_api_rate_limit(v_uid::text,'support_ticket_create',5,3600) then raise exception 'Too many support tickets. Please wait before creating another ticket.'; end if;
  if p_order_id is not null then select * into v_order from public.orders where id=p_order_id and user_id=v_uid; if not found then raise exception 'Order not found for this customer'; end if; end if;
  if p_channel='seller_support' then
    if p_order_id is null or p_product_id is null then raise exception 'Seller support requires an order and purchased product'; end if;
    if not exists(select 1 from jsonb_array_elements(v_order.items) x where (x->>'id')::bigint=p_product_id and (p_variant_id is null or nullif(x->>'variant_id','')::bigint=p_variant_id)) then raise exception 'Selected product was not found in this order'; end if;
    select s.seller_id into v_seller from public.seller_product_submissions s where s.approved_product_id=p_product_id and s.status='approved' order by s.reviewed_at desc nulls last,s.id desc limit 1;
    if v_seller is null then raise exception 'This product is not linked to an active marketplace seller'; end if;
    if not exists(select 1 from public.seller_profiles sp where sp.user_id=v_seller and sp.status='active') then raise exception 'Seller support is currently unavailable for this product'; end if;
  end if;
  select * into v_existing from public.support_tickets t where t.customer_id=v_uid and t.channel=p_channel and coalesce(t.order_id,0)=coalesce(p_order_id,0) and coalesce(t.product_id,0)=coalesce(p_product_id,0) and lower(t.issue_type)=lower(btrim(p_issue_type)) and t.status<>'closed' order by t.created_at desc limit 1;
  if found then
    insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source) values(v_existing.id,v_uid,'customer',btrim(p_message),'web');
    if p_channel='customer_support' and v_existing.support_mode='bot' then perform public.support_bot_process_customer_message(v_existing.id,p_message);
    else update public.support_tickets set status=case when p_channel='seller_support' then 'waiting_seller' else 'waiting_admin' end,updated_at=now() where id=v_existing.id; end if;
    select * into v_existing from public.support_tickets where id=v_existing.id;
    return v_existing;
  end if;
  insert into public.support_tickets(channel,customer_id,order_id,product_id,variant_id,seller_id,issue_type,subject,status,support_mode) values(p_channel,v_uid,p_order_id,p_product_id,p_variant_id,v_seller,btrim(p_issue_type),btrim(p_subject),case when p_channel='seller_support' then 'waiting_seller' else 'open' end,case when p_channel='customer_support' then 'bot' else 'human' end) returning * into v_ticket;
  insert into public.support_ticket_messages(ticket_id,sender_user_id,sender_role,message,source) values(v_ticket.id,v_uid,'customer',btrim(p_message),'web');
  if p_channel='customer_support' then perform public.support_bot_process_customer_message(v_ticket.id,p_message); select * into v_ticket from public.support_tickets where id=v_ticket.id; end if;
  return v_ticket;
end;
$function$;

revoke execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) from public,anon;
grant execute on function public.create_support_ticket(text,bigint,bigint,bigint,text,text,text) to authenticated;
