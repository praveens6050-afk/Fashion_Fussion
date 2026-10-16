-- Fresh local database contract checks only. This file runs under supabase test db.
-- All assertions use schema metadata or empty/synthetic inputs; no production connection is used.

begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select ok(
  coalesce((
    select c.relrowsecurity
    from pg_class c
    where c.oid = 'public.creator_attribution_sessions'::regclass
  ), false),
  'creator attribution sessions has row-level security enabled'
);

select ok(
  exists (
    select 1
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'creator_attribution_sessions'
      and p.policyname = 'creator_attribution_no_direct_select'
      and 'authenticated'::name = any (p.roles)
      and p.qual = 'false'
  ),
  'creator attribution direct reads are denied to authenticated users'
);

select ok(
  to_regprocedure('public.get_seller_fast_dispatch_signal(uuid)') is not null,
  'fast-dispatch signal function is installed'
);

select ok(
  not has_function_privilege('anon', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'anonymous users cannot execute the fast-dispatch function'
);

select ok(
  not has_function_privilege('authenticated', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'authenticated users cannot execute the fast-dispatch function'
);

select ok(
  has_function_privilege('service_role', 'public.get_seller_fast_dispatch_signal(uuid)', 'EXECUTE'),
  'service_role can execute the fast-dispatch function'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'seller_id'
  ),
  'seller attribution does not assume orders.seller_id exists'
);

select ok(
  position(
    'seller_product_submissions'
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch attribution uses seller product submissions'
);

select ok(
  position(
    'approved_product_id'
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch attribution maps approved product IDs'
);

select ok(
  position(
    'sps.status = ''approved'''
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch attribution only uses approved seller products'
);

select ok(
  position(
    '''^[0-9]+$'''
    in pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure)
  ) > 0,
  'fast-dispatch attribution rejects malformed persisted product IDs'
);

select ok(
  position(
    'a.sample_orders >= 10'
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch requires at least ten qualifying orders'
);

select ok(
  position(
    '>= 0.90'
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch requires at least a ninety percent on-time rate'
);

select ok(
  position(
    'a.avg_dispatch_hours <= 24'
    in lower(pg_get_functiondef('public.get_seller_fast_dispatch_signal(uuid)'::regprocedure))
  ) > 0,
  'fast-dispatch requires an average dispatch time within twenty-four hours'
);

select results_eq(
  $query$
    select sample_orders, fast_dispatch_orders, fast_dispatch_rate,
           avg_dispatch_hours, fast_dispatch
    from public.get_seller_fast_dispatch_signal('00000000-0000-0000-0000-000000000001'::uuid)
  $query$,
  $expected$
    values (0::bigint, 0::bigint, 0::numeric, 0::numeric, false)
  $expected$,
  'a seller with no qualifying orders receives an empty, non-fast signal'
);

select ok(
  to_regprocedure(
    'public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text)'
  ) is not null,
  'seller settlement calculation entry point is installed'
);

select ok(
  position(
    'ifv_launch_zerothenv_platform:=0;v_commission_gst:=0;'
    in regexp_replace(
      lower(pg_get_functiondef(
        'public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text)'::regprocedure
      )),
      '[[:space:]]',
      '',
      'g'
    )
  ) > 0,
  'active zero-commission launch protection zeros commission and commission GST'
);

select ok(
  position(
    'v_fees:=round((v_platform+v_commission_gst+coalesce(p_payment_fee_amount,0)+coalesce(p_shipping_deduction_amount,0)+coalesce(p_return_deduction_amount,0)+coalesce(p_other_deduction_amount,0))::numeric,2)'
    in regexp_replace(
      lower(pg_get_functiondef(
        'public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text)'::regprocedure
      )),
      '[[:space:]]',
      '',
      'g'
    )
  ) > 0,
  'settlement fees include commission GST, payment, shipping, return and other deductions'
);

select ok(
  position(
    'v_net:=round((p_gross_amount-v_fees-p_refunds_amount)::numeric,2)'
    in regexp_replace(
      lower(pg_get_functiondef(
        'public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text)'::regprocedure
      )),
      '[[:space:]]',
      '',
      'g'
    )
  ) > 0,
  'seller net settlement subtracts fees and refunds from gross'
);

select ok(
  position(
    'coalesce(p_gross_amount,-1)<0'
    in regexp_replace(
      lower(pg_get_functiondef(
        'public.admin_upsert_seller_settlement_breakdown(uuid,bigint,date,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text,text,text)'::regprocedure
      )),
      '[[:space:]]',
      '',
      'g'
    )
  ) > 0,
  'settlement calculation rejects negative financial inputs'
);

select * from finish();

rollback;
