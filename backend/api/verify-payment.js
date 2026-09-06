const crypto = require("crypto");

const {
  KEY_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser
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

  if (!KEY_SECRET) {
    return json(res, 500, {
      error:
        "Razorpay server key is not configured"
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
      1. Verify logged-in Supabase user
    */
    const user =
      await getSupabaseUser(req);

    /*
      2. Read Razorpay response
    */
    const body =
      await readBody(req);

    const {
      order_id,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = body;

    if (
      !order_id ||
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Missing payment fields"
      });
    }

    /*
      3. Make sure all order IDs match
    */
    if (
      order_id !==
      razorpay_order_id
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Order ID mismatch"
      });
    }

    /*
      4. Verify Razorpay signature
    */
    const expectedSignature =
      crypto
        .createHmac(
          "sha256",
          KEY_SECRET
        )
        .update(
          order_id +
            "|" +
            razorpay_payment_id
        )
        .digest("hex");

    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        "utf8"
      );

    const receivedBuffer =
      Buffer.from(
        razorpay_signature,
        "utf8"
      );

    if (
      expectedBuffer.length !==
        receivedBuffer.length ||
      !crypto.timingSafeEqual(
        expectedBuffer,
        receivedBuffer
      )
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Invalid payment signature"
      });
    }

    /*
      5. Fetch payment from Razorpay
    */
    const paymentResponse =
      await fetch(
        "https://api.razorpay.com/v1/payments/" +
          encodeURIComponent(
            razorpay_payment_id
          ),
        {
          headers: {
            Authorization:
              basicAuth()
          }
        }
      );

    const payment =
      await paymentResponse.json();

    if (!paymentResponse.ok) {
      return json(res, 502, {
        verified: false,
        error:
          "Could not verify payment status"
      });
    }

    /*
      6. Verify payment belongs to this order
    */
    if (
      payment.order_id !==
      order_id
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Payment/order mismatch"
      });
    }

    /*
      7. Verify captured status
    */
    if (
      payment.status !==
      "captured"
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Payment is not captured yet"
      });
    }

    /*
      8. Get our pending Supabase order
    */
    const orderLookup =
      await fetch(
        SUPABASE_URL +
          "/rest/v1/orders" +
          "?razorpay_order_id=eq." +
          encodeURIComponent(
            order_id
          ) +
          "&select=id,user_id,total_amount,status,items",
        {
          headers: {
            apikey:
              SUPABASE_SERVICE_ROLE_KEY,

            Authorization:
              "Bearer " +
              SUPABASE_SERVICE_ROLE_KEY
          }
        }
      );

    const orders =
      await orderLookup.json();

    if (
      !orderLookup.ok
    ) {
      console.error(
        "Order lookup failed:",
        orders
      );

      return json(res, 500, {
        verified: false,
        error:
          "Could not load store order"
      });
    }

    if (
      !orders.length
    ) {
      return json(res, 404, {
        verified: false,
        error:
          "Store order was not found"
      });
    }

    const storeOrder =
      orders[0];

    /*
      Security check:
      this Razorpay order must belong
      to the currently logged-in user.
    */
    if (
      storeOrder.user_id !==
      user.id
    ) {
      return json(res, 403, {
        verified: false,
        error:
          "This order does not belong to the current user"
      });
    }

    /*
      9. Verify paid amount equals
         our stored order amount.
    */
    const expectedAmount =
      Math.round(
        Number(
          storeOrder.total_amount
        ) * 100
      );

    const paidAmount =
      Number(payment.amount);

    if (
      expectedAmount !==
      paidAmount
    ) {
      return json(res, 400, {
        verified: false,
        error:
          "Payment amount does not match order amount"
      });
    }

    /*
      10. Prevent duplicate processing.
    */
    if (
      storeOrder.status ===
        "paid"
    ) {
      return json(res, 200, {
        verified: true,
        already_processed: true,
        payment_id:
          razorpay_payment_id,
        status: "paid"
      });
    }

    /*
      11. Update Supabase order.
    */
    const updateResponse =
      await fetch(
        SUPABASE_URL +
          "/rest/v1/orders" +
          "?razorpay_order_id=eq." +
          encodeURIComponent(
            order_id
          ) +
          "&user_id=eq." +
          encodeURIComponent(
            user.id
          ),
        {
          method: "PATCH",

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
            razorpay_payment_id:
              razorpay_payment_id,

            status:
              "paid"
          })
        }
      );

    const updated =
      await updateResponse.json();

    if (
      !updateResponse.ok
    ) {
      console.error(
        "Supabase order update failed:",
        updated
      );

      return json(res, 500, {
        verified: false,
        error:
          "Payment was verified but the store order could not be updated"
      });
    }

    /*
      12. Success
    */
    return json(res, 200, {
      verified: true,

      payment_id:
        razorpay_payment_id,

      order_id,

      status: "paid"
    });

  } catch (error) {
    console.error(
      "verify-payment error:",
      error
    );

    return json(res, 400, {
      verified: false,
      error:
        error.message ||
        "Payment verification failed"
    });
  }
};
