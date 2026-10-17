-- coupon_redemptions: combine admin + own SELECT
DROP POLICY IF EXISTS "Admins can view coupon redemptions" ON public.coupon_redemptions;
DROP POLICY IF EXISTS "Users can view own coupon redemptions" ON public.coupon_redemptions;
CREATE POLICY "Authenticated can view permitted coupon redemptions"
ON public.coupon_redemptions FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);

-- coupons: split admin ALL so SELECT can be a single policy
DROP POLICY IF EXISTS "Admins can manage coupons" ON public.coupons;
DROP POLICY IF EXISTS "Customers can view active coupons" ON public.coupons;
CREATE POLICY "Authenticated can view permitted coupons"
ON public.coupons FOR SELECT TO authenticated
USING (
  (is_active=true AND starts_at<=now() AND (expires_at IS NULL OR expires_at>now()))
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);
CREATE POLICY "Admins can insert coupons" ON public.coupons FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can update coupons" ON public.coupons FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can delete coupons" ON public.coupons FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));

-- support messages: combine INSERT and SELECT pairs
DROP POLICY IF EXISTS "Admins can send support messages" ON public.customer_support_messages;
DROP POLICY IF EXISTS "Customers can send support messages" ON public.customer_support_messages;
DROP POLICY IF EXISTS "Admins can view support messages" ON public.customer_support_messages;
DROP POLICY IF EXISTS "Customers can view own support messages" ON public.customer_support_messages;
CREATE POLICY "Authenticated can send permitted support messages"
ON public.customer_support_messages FOR INSERT TO authenticated
WITH CHECK (
  (sender_type='admin' AND sender_user_id=(SELECT auth.uid()) AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true))
  OR
  (sender_type='customer' AND sender_user_id=(SELECT auth.uid()) AND EXISTS (
    SELECT 1 FROM public.customer_support_requests r
    WHERE r.id=customer_support_messages.request_id AND r.user_id=(SELECT auth.uid()) AND r.status='accepted'
  ))
);
CREATE POLICY "Authenticated can view permitted support messages"
ON public.customer_support_messages FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
  OR EXISTS (SELECT 1 FROM public.customer_support_requests r WHERE r.id=customer_support_messages.request_id AND r.user_id=(SELECT auth.uid()))
);

-- support requests: combine SELECT and UPDATE pairs
DROP POLICY IF EXISTS "Admins can view support requests" ON public.customer_support_requests;
DROP POLICY IF EXISTS "Customers can view own support requests" ON public.customer_support_requests;
DROP POLICY IF EXISTS "Admins can update support requests" ON public.customer_support_requests;
DROP POLICY IF EXISTS "Customers can update own pending support requests" ON public.customer_support_requests;
CREATE POLICY "Authenticated can view permitted support requests"
ON public.customer_support_requests FOR SELECT TO authenticated
USING (
  user_id=(SELECT auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);
CREATE POLICY "Authenticated can update permitted support requests"
ON public.customer_support_requests FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
  OR (user_id=(SELECT auth.uid()) AND status='pending')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
  OR user_id=(SELECT auth.uid())
);

-- gift card redemptions: combine admin + own SELECT
DROP POLICY IF EXISTS "Admins can view gift card redemptions" ON public.gift_card_redemptions;
DROP POLICY IF EXISTS "Users can view own gift card redemptions" ON public.gift_card_redemptions;
CREATE POLICY "Authenticated can view permitted gift card redemptions"
ON public.gift_card_redemptions FOR SELECT TO authenticated
USING (
  user_id=(SELECT auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);

-- gift_cards: split admin ALL and combine SELECT
DROP POLICY IF EXISTS "Admins can manage gift cards" ON public.gift_cards;
DROP POLICY IF EXISTS "Customers can view active gift cards" ON public.gift_cards;
CREATE POLICY "Authenticated can view permitted gift cards"
ON public.gift_cards FOR SELECT TO authenticated
USING (
  is_active=true
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);
CREATE POLICY "Admins can insert gift cards" ON public.gift_cards FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can update gift cards" ON public.gift_cards FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can delete gift cards" ON public.gift_cards FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));

-- orders: combine admin + own SELECT, preserving public/anon no-row behavior
DROP POLICY IF EXISTS "Admins can view all orders" ON public.orders;
DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Authenticated can view permitted orders"
ON public.orders FOR SELECT TO authenticated
USING (
  user_id=(SELECT auth.uid())
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);

-- products: remove duplicate active-product SELECT and split admin ALL
DROP POLICY IF EXISTS "Admins can manage products" ON public.products;
DROP POLICY IF EXISTS "Anyone can view active products" ON public.products;
DROP POLICY IF EXISTS "Public can view active products" ON public.products;
CREATE POLICY "Public can view active products"
ON public.products FOR SELECT TO anon, authenticated
USING (
  is_active=true
  OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true)
);
CREATE POLICY "Admins can insert products" ON public.products FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can update products" ON public.products FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));
CREATE POLICY "Admins can delete products" ON public.products FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid()) AND p.is_admin=true));

-- profiles: remove redundant broader UPDATE policy; keep the policy that prevents changing is_admin
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
