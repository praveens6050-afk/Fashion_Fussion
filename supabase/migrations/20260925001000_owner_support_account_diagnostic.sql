create or replace function public.owner_get_support_account_diagnostic(p_ticket_code text)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_customer jsonb := '{}'::jsonb;
  v_seller jsonb := '{}'::jsonb;
  v_customer_signals jsonb := '[]'::jsonb;
  v_seller_signals jsonb := '[]'::jsonb;
begin
  if not public.is_owner_user(auth.uid()) then raise exception 'Owner access required'; end if;
  select * into v_ticket from public.support_tickets where upper(ticket_code)=upper(trim(p_ticket_code)) limit 1;
  if not found then raise exception 'Ticket not found'; end if;

  if v_ticket.customer_id is not null then
    select jsonb_build_object(
      'profile',jsonb_build_object('customer_id',p.id,'full_name',p.full_name,'phone',p.phone,'email',u.email,'email_confirmed',u.email_confirmed_at is not null,'last_sign_in_at',u.last_sign_in_at,'created_at',u.created_at),
      'orders',jsonb_build_object(
        'total',(select count(*) from public.orders o where o.user_id=p.id),
        'payment_failed',(select count(*) from public.orders o where o.user_id=p.id and o.status='payment_failed'),
        'cancelled',(select count(*) from public.orders o where o.user_id=p.id and (o.status in ('cancelled','cod_cancelled') or o.fulfillment_status='cancelled')),
        'open_fulfillment',(select count(*) from public.orders o where o.user_id=p.id and o.fulfillment_status not in ('delivered','cancelled')),
        'recent',coalesce((select jsonb_agg(x.obj order by x.created_at desc) from (select o.created_at,jsonb_build_object('display_order_id',o.display_order_id,'total_amount',o.total_amount,'status',o.status,'payment_method',o.payment_method,'fulfillment_status',o.fulfillment_status,'refund_status',o.refund_status,'created_at',o.created_at) obj from public.orders o where o.user_id=p.id order by o.created_at desc limit 10)x),'[]'::jsonb)
      ),
      'returns',jsonb_build_object('open',(select count(*) from public.return_requests r where r.user_id=p.id and r.status not in ('completed','rejected','cancelled')),'total',(select count(*) from public.return_requests r where r.user_id=p.id)),
      'support',jsonb_build_object('open',(select count(*) from public.support_tickets t where t.customer_id=p.id and t.status not in ('closed','resolved')),'reopened',coalesce((select sum(t.reopen_count) from public.support_tickets t where t.customer_id=p.id),0))
    ) into v_customer
    from public.profiles p join auth.users u on u.id=p.id where p.id=v_ticket.customer_id;

    if coalesce((v_customer#>>'{profile,email_confirmed}')::boolean,false)=false then v_customer_signals:=v_customer_signals||jsonb_build_array('Email not confirmed'); end if;
    if coalesce((v_customer#>>'{orders,payment_failed}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has failed payment order(s)'); end if;
    if coalesce((v_customer#>>'{orders,cancelled}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has cancelled order(s)'); end if;
    if coalesce((v_customer#>>'{returns,open}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has open return/exchange request(s)'); end if;
    if coalesce((v_customer#>>'{support,reopened}')::int,0)>0 then v_customer_signals:=v_customer_signals||jsonb_build_array('Has reopened support ticket(s)'); end if;
  end if;

  if v_ticket.seller_id is not null then
    select jsonb_build_object(
      'profile',jsonb_build_object('seller_id',s.user_id,'seller_code',s.seller_code,'store_name',s.store_name,'seller_type',s.seller_type,'phone',s.phone,'email',u.email,'status',s.status,'created_at',s.created_at),
      'kyc',coalesce((select jsonb_build_object('status',c.verification_status,'legal_name',c.legal_name,'pan_last4',c.pan_last4,'gstin_last4',c.gstin_last4,'rejection_reason',c.rejection_reason,'updated_at',c.updated_at) from public.seller_compliance_profiles c where c.seller_id=s.user_id),'{}'::jsonb),
      'payout',coalesce((select jsonb_build_object('status',pp.verification_status,'bank_name',pp.bank_name,'account_last4',pp.account_number_last4,'ifsc',pp.ifsc,'rejection_reason',pp.rejection_reason,'updated_at',pp.updated_at) from public.seller_payout_profiles pp where pp.seller_id=s.user_id),'{}'::jsonb),
      'pickup',jsonb_build_object('active_count',(select count(*) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active),'default_count',(select count(*) from public.seller_pickup_locations l where l.seller_id=s.user_id and l.is_active and l.is_default)),
      'products',jsonb_build_object('pending',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='pending'),'rejected',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='rejected'),'approved',(select count(*) from public.seller_product_submissions x where x.seller_id=s.user_id and x.status='approved')),
      'settlements',jsonb_build_object('pending',(select count(*) from public.seller_settlements st where st.seller_id=s.user_id and st.status in ('pending','processing','held')),'failed',(select count(*) from public.seller_settlements st where st.seller_id=s.user_id and st.status='failed'),'recent',coalesce((select jsonb_agg(x.obj order by x.id desc) from (select st.id,jsonb_build_object('id',st.id,'period_start',st.period_start,'period_end',st.period_end,'net_amount',st.net_amount,'status',st.status,'failure_reason',st.failure_reason,'paid_at',st.paid_at) obj from public.seller_settlements st where st.seller_id=s.user_id order by st.id desc limit 10)x),'[]'::jsonb)),
      'support',jsonb_build_object('open',(select count(*) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id and t.status not in ('closed','resolved')),'reopened',coalesce((select sum(t.reopen_count) from public.support_tickets t where t.channel='seller_support' and t.seller_id=s.user_id),0))
    ) into v_seller
    from public.seller_profiles s join auth.users u on u.id=s.user_id where s.user_id=v_ticket.seller_id;

    if coalesce(v_seller#>>'{profile,status}','')<>'active' then v_seller_signals:=v_seller_signals||jsonb_build_array('Seller account is not active'); end if;
    if coalesce(v_seller#>>'{kyc,status}','draft')<>'verified' then v_seller_signals:=v_seller_signals||jsonb_build_array('KYC is not verified'); end if;
    if coalesce(v_seller#>>'{payout,status}','draft')<>'verified' then v_seller_signals:=v_seller_signals||jsonb_build_array('Payout account is not verified'); end if;
    if coalesce((v_seller#>>'{pickup,active_count}')::int,0)=0 then v_seller_signals:=v_seller_signals||jsonb_build_array('No active pickup location'); end if;
    if coalesce((v_seller#>>'{products,rejected}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has rejected product submission(s)'); end if;
    if coalesce((v_seller#>>'{settlements,failed}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has failed settlement(s)'); end if;
    if coalesce((v_seller#>>'{settlements,pending}')::int,0)>0 then v_seller_signals:=v_seller_signals||jsonb_build_array('Has pending/held settlement(s)'); end if;
  end if;

  return jsonb_build_object('ticket',jsonb_build_object('ticket_code',v_ticket.ticket_code,'channel',v_ticket.channel,'status',v_ticket.status,'priority',v_ticket.priority,'issue_type',v_ticket.issue_type,'subject',v_ticket.subject,'order_id',v_ticket.order_id,'created_at',v_ticket.created_at,'updated_at',v_ticket.updated_at),'customer',v_customer,'customer_signals',v_customer_signals,'seller',v_seller,'seller_signals',v_seller_signals,'read_only',true);
end $$;
revoke all on function public.owner_get_support_account_diagnostic(text) from public,anon;
grant execute on function public.owner_get_support_account_diagnostic(text) to authenticated;
