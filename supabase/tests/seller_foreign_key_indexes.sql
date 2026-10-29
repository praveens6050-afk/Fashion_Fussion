DO $$
BEGIN
  IF to_regclass('public.seller_creator_offers_product_id_idx') IS NULL THEN
    RAISE EXCEPTION 'missing index seller_creator_offers_product_id_idx';
  END IF;
  IF to_regclass('public.seller_leads_converted_seller_id_idx') IS NULL THEN
    RAISE EXCEPTION 'missing index seller_leads_converted_seller_id_idx';
  END IF;
END $$;
