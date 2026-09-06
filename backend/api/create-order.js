const {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser,
  calculate
} = require("../lib");

module.exports = async function (req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      error: "Method not allowed"
    });
  }

  if (
    !KEY_ID ||
    !KEY_SECRET
  ) {
    return json(res, 500, {
      error:
        "Razorpay server keys are not configured"
    });
  }

  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return json(res, 500, {
      error:
        "Supabase server configuration is not configured"
    });
  }

  try {
    /*
      1. Verify Supabase login
    */
    const user =
      await getSupabaseUser(req);

    /*
      2. Read cart
    */
    const body =
      await readBody(req);

    const calc =
      await calculate(body.items);

    /*
      3. Customer details
    */
    const customerName =
      String(
        body.customer_name || ""
      ).trim();

    const customerPhone =
      String(
        body.customer_phone || ""
      ).trim();

    if (!customerName) {
      throw new Error(
        "Customer name is required"
      );
    }

    if (!customerPhone) {
      throw new Error(
        "Customer phone is required"
      );
    }

    /*
      4. Create Razorpay order
    */
    const receipt =
      "FF_" +
      Date.now() +
      "_" +
      Math.random()
        .toString(36)
        .slice(2, 8);

    const razorpayResponse =
      await fetch(
        "https://api.razorpay.com/v1/orders",
        {
          method: "POST",

          headers: {
            Authorization: basicAuth(),
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            amount:
              Math.round(
                calc.total * 100
              ),

            currency: "INR",

            receipt,

            notes: {
              store:
                "Fashion_Fussion",

              user_id:
                user.id
            },

            partial_payment: false
          })
        }
      );

    const razorpayOrder =
      await razorpayResponse.json();

    if (!razorpayResponse.ok) {
      return json(res, 502, {
        error:
          razorpayOrder?.error
            ?.description ||
          "Razorpay order creation failed"
      });
    }

    /*
      5. Save a pending order in Supabase.

      The important part:
      the server has already calculated the
      real product prices.
    */
    const supabaseResponse =
      await fetch(
        SUPABASE_URL +
          "/rest/v1/orders",
        {
          method: "POST",

          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              "Bearer " +
              SUPABASE_SERVICE_ROLE_KEY,

            "Content-Type":
              "application/json",

            Prefer:
              "return=representation"
          },

          body: JSON.stringify({
            user_id: user.id,

            razorpay_order_id:
              razorpayOrder.id,

            total_amount:
              calc.total,

            currency: "INR",

            status: "created",

            customer_name:
              customerName,

            customer_email:
              user.email || null,

            customer_phone:
              customerPhone,

            items:
              calc.items
          })
        }
      );

    const supabaseData =
      await supabaseResponse.json();

    if (!supabaseResponse.ok) {
      console.error(
        "Supabase order insert failed:",
        supabaseData
      );

      return json(res, 500, {
        error:
          "Payment order was created, but the store could not save the order. Please contact support before retrying."
      });
    }

    /*
      6. Send only safe information to browser.
    */
    return json(res, 200, {
  key_id: KEY_ID,

  order: {
    id: razorpayOrder.id,
    amount: razorpayOrder.amount,
    currency: razorpayOrder.currency
  },

  items: calc.items,

  pricing: {
    subtotal: calc.subtotal,
    discount: calc.discount,
    gst: calc.gst,
    delivery: calc.delivery,
    other_charges: calc.other_charges,
    total: calc.total
  },

  total: calc.total
});
  } catch (error) {
    console.error(
      "create-order error:",
      error
    );

    return json(res, 400, {
      error:
        error.message ||
        "Unable to create order"
    });
  }
};
