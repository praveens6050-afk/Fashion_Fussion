const {
  KEY_ID, KEY_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  cors, json, readBody, basicAuth, getSupabaseUser, calculate
} = require("../lib");

async function getDefaultAddress(userId) {
  const response = await fetch(
    SUPABASE_URL + "/rest/v1/customer_addresses?user_id=eq." + encodeURIComponent(userId) + "&is_default=eq.true&select=id,label,full_name,phone,address_line1,address_line2,city,state,postal_code,country&limit=1",
    { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY } }
  );
  const data = await response.json();
  if (!response.ok) throw new Error("Could not load your delivery address");
  return data?.[0] || null;
}

module.exports = async function (req, res) {
  cors(res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return json(res, 405, { error: "Method not allowed" });
  if (!KEY_ID || !KEY_SECRET) return json(res, 500, { error: "Razorpay server keys are not configured" });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json(res, 500, { error: "Supabase server configuration is not configured" });

  try {
    const user = await getSupabaseUser(req);

    if (!user.phone || !user.phone_confirmed_at) {
      throw new Error("Please verify your mobile number with OTP before checkout.");
    }

    const body = await readBody(req);
    const calc = await calculate(body.items);
    const customerName = String(body.customer_name || "").trim();
    if (!customerName) throw new Error("Customer name is required");

    const address = body.shipping_address && typeof body.shipping_address === "object"
      ? body.shipping_address
      : await getDefaultAddress(user.id);

    if (!address) throw new Error("Please add a delivery address before checkout.");

    const customerPhone = String(user.phone).trim();
    const requiredAddress = [address.full_name, address.phone, address.address_line1, address.city, address.state, address.postal_code, address.country];
    if (requiredAddress.some(v => !String(v || "").trim())) throw new Error("Please complete your delivery address before checkout.");
    if (String(address.phone).trim() !== customerPhone) throw new Error("Your delivery address mobile number must match your verified account mobile number.");

    const receipt = "FF_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: basicAuth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(calc.total * 100), currency: "INR", receipt,
        notes: { store: "Fashion_Fussion", user_id: user.id }, partial_payment: false
      })
    });
    const razorpayOrder = await razorpayResponse.json();
    if (!razorpayResponse.ok) return json(res, 502, { error: razorpayOrder?.error?.description || "Razorpay order creation failed" });

    const supabaseResponse = await fetch(SUPABASE_URL + "/rest/v1/orders", {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({
        user_id: user.id,
        razorpay_order_id: razorpayOrder.id,
        total_amount: calc.total,
        currency: "INR",
        status: "created",
        customer_name: customerName,
        customer_email: user.email || null,
        customer_phone: customerPhone,
        items: calc.items,
        shipping_address: {
          id: address.id || null,
          label: String(address.label || "Home").trim(),
          full_name: String(address.full_name).trim(),
          phone: customerPhone,
          address_line1: String(address.address_line1).trim(),
          address_line2: address.address_line2 ? String(address.address_line2).trim() : null,
          city: String(address.city).trim(),
          state: String(address.state).trim(),
          postal_code: String(address.postal_code).trim(),
          country: String(address.country).trim()
        }
      })
    });
    const supabaseData = await supabaseResponse.json();
    if (!supabaseResponse.ok) {
      console.error("Supabase order insert failed:", supabaseData);
      return json(res, 500, { error: "Payment order was created, but the store could not save the order. Please contact support before retrying." });
    }

    return json(res, 200, {
      key_id: KEY_ID,
      order: { id: razorpayOrder.id, amount: razorpayOrder.amount, currency: razorpayOrder.currency },
      items: calc.items,
      pricing: { subtotal: calc.subtotal, discount: calc.discount, gst: calc.gst, delivery: calc.delivery, other_charges: calc.other_charges, total: calc.total },
      shipping_address: {
        label: address.label || "Home", full_name: address.full_name, phone: customerPhone,
        address_line1: address.address_line1, address_line2: address.address_line2 || null,
        city: address.city, state: address.state, postal_code: address.postal_code, country: address.country
      },
      total: calc.total
    });
  } catch (error) {
    console.error("create-order error:", error);
    return json(res, 400, { error: error.message || "Unable to create order" });
  }
};
