revoke execute on function public.get_seller_finance_profile() from public, anon;
grant execute on function public.get_seller_finance_profile() to authenticated;

revoke execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.save_seller_compliance_profile(text,text,text,text,boolean,text,text,text,text,text,text,text) to authenticated;
