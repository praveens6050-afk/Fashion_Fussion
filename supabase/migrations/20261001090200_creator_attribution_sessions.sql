create table if not exists public.creator_attribution_sessions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  creator_link_id uuid not null references public.creator_links(id) on delete cascade,
  product_id bigint not null references public.products(id) on delete cascade,
  attributed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days')
);
create index if not exists creator_attribution_sessions_creator_link_idx on public.creator_attribution_sessions(creator_link_id);
create index if not exists creator_attribution_sessions_product_idx on public.creator_attribution_sessions(product_id);
alter table public.creator_attribution_sessions enable row level security;
revoke all on public.creator_attribution_sessions from public,anon,authenticated;
create policy creator_attribution_no_direct_select on public.creator_attribution_sessions for select to authenticated using(false);

create or replace function public.record_creator_attribution(p_code text) returns jsonb language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_uid uuid:=auth.uid(); v_link public.creator_links%rowtype;
begin
 if v_uid is null then raise exception 'Authentication required'; end if;
 select cl.* into v_link from public.creator_links cl join public.creator_profiles cp on cp.user_id=cl.creator_id where cl.code=upper(trim(coalesce(p_code,''))) and cl.active=true and cp.status='approved' limit 1;
 if v_link.id is null then raise exception 'Creator referral is invalid or inactive'; end if;
 insert into public.creator_attribution_sessions(user_id,creator_link_id,product_id,attributed_at,expires_at)
 values(v_uid,v_link.id,v_link.product_id,now(),now()+interval '7 days')
 on conflict(user_id) do update set creator_link_id=excluded.creator_link_id,product_id=excluded.product_id,attributed_at=excluded.attributed_at,expires_at=excluded.expires_at;
 return jsonb_build_object('recorded',true,'product_id',v_link.product_id,'expires_at',now()+interval '7 days');
end $$;
revoke all on function public.record_creator_attribution(text) from public,anon;
grant execute on function public.record_creator_attribution(text) to authenticated,service_role;

create or replace function public.attach_creator_attribution_to_order() returns trigger language plpgsql security definer set search_path='pg_catalog','public' as $$
declare v_session public.creator_attribution_sessions%rowtype;
begin
 if new.creator_link_id is not null then return new; end if;
 select * into v_session from public.creator_attribution_sessions where user_id=new.user_id and expires_at>now() order by attributed_at desc limit 1;
 if v_session.user_id is null then return new; end if;
 if exists(select 1 from jsonb_array_elements(new.items) item where nullif(item->>'id','')::bigint=v_session.product_id) then new.creator_link_id:=v_session.creator_link_id; end if;
 return new;
end $$;
revoke all on function public.attach_creator_attribution_to_order() from public,anon,authenticated;
drop trigger if exists trg_attach_creator_attribution_to_order on public.orders;
create trigger trg_attach_creator_attribution_to_order before insert on public.orders for each row execute function public.attach_creator_attribution_to_order();
