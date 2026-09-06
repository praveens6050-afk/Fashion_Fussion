const crypto = require("crypto");

const {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
} = {
  KEY_ID: process.env.RAZORPAY_KEY_ID,
  KEY_SECRET: process.env.RAZORPAY_KEY_SECRET,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY
};

const DELIVERY_THRESHOLD = 599;
const DELIVERY_BELOW_THRESHOLD = 49;

/*
  Product-specific GST rates.

  IMPORTANT:
  These are store configuration values.
  Confirm the final GST/HSN classification for each
  product with your tax/accounting adviser.

  Current store configuration:
  Product IDs 1-57 = 18% GST.
*/
const GST_RATES = {
  1: 18,
  2: 18,
  3: 18,
  4: 18,
  5: 18,
  6: 18,
  7: 18,
  8: 18,
  9: 18,
  10: 18,
  11: 18,
  12: 18,
  13: 18,
  14: 18,
  15: 18,
  16: 18,
  17: 18,
  18: 18,
  19: 18,
  20: 18,
  21: 18,
  22: 18,
  23: 18,
  24: 18,
  25: 18,
  26: 18,
  27: 18,
  28: 18,
  29: 18,
  30: 18,
  31: 18,
  32: 18,
  33: 18,
  34: 18,
  35: 18,
  36: 18,
  37: 18,
  38: 18,
  39: 18,
  40: 18,
  41: 18,
  42: 18,
  43: 18,
  44: 18,
  45: 18,
  46: 18,
  47: 18,
  48: 18,
  49: 18,
  50: 18,
  51: 18,
  52: 18,
  53: 18,
  54: 18,
  55: 18,
  56: 18,
  57: 18
};

function cors(res) {
  const origin =
    process.env.ALLOWED_ORIGIN || "*";

  res.setHeader(
    "Access-Control-Allow-Origin",
    origin
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST,OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
}

function json(res, status, body) {
  res.statusCode = status;

  res.setHeader(
    "Content-Type",
    "application/json"
  );

  cors(res);

  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", chunk => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function basicAuth() {
  return (
    "Basic " +
    Buffer.from(
      KEY_ID + ":" + KEY_SECRET
    ).toString("base64")
  );
}

async function getSupabaseUser(req) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase server configuration is missing"
    );
  }

  const authHeader =
    req.headers.authorization ||
    req.headers.Authorization;

  if (
    !authHeader ||
    !authHeader.startsWith("Bearer ")
  ) {
    throw new Error(
      "Please log in before checkout"
    );
  }

  const accessToken =
    authHeader.substring(7).trim();

  const response = await fetch(
    SUPABASE_URL + "/auth/v1/user",
    {
      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          "Bearer " + accessToken
      }
    }
  );

  const data =
    await response.json();

  if (
    !response.ok ||
    !data?.id
  ) {
    throw new Error(
      "Your login session has expired. Please log in again."
    );
  }

  return data;
}

async function getProductsByIds(ids) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase server configuration is missing"
    );
  }

  if (
    !Array.isArray(ids) ||
    !ids.length
  ) {
    throw new Error("Cart is empty");
  }

  const cleanIds =
    ids.map(id => {
      const value =
        String(id).trim();

      if (
        !/^\d+$/.test(value)
      ) {
        throw new Error(
          "Invalid product ID"
        );
      }

      return value;
    });

  const uniqueIds = [
    ...new Set(cleanIds)
  ];

  const url =
    SUPABASE_URL +
    "/rest/v1/products" +
    "?id=in.(" +
    uniqueIds.join(",") +
    ")" +
    "&is_active=eq.true" +
    "&select=id,name,category,price,image_url";

  const response =
    await fetch(url, {
      headers: {
        apikey:
          SUPABASE_SERVICE_ROLE_KEY,

        Authorization:
          "Bearer " +
          SUPABASE_SERVICE_ROLE_KEY
      }
    });

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "Could not load products from Supabase"
    );
  }

  return data;
}

/*
  Authoritative server-side checkout calculation.

  Browser prices are NEVER trusted.

  Calculation:

  product price
  - discount
  + GST
  + delivery
  + other applicable charges
  = final total
*/
async function calculate(items) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    throw new Error("Cart is empty");
  }

  const ids =
    items.map(item => item.id);

  const products =
    await getProductsByIds(ids);

  const productMap =
    new Map(
      products.map(product => [
        String(product.id),
        product
      ])
    );

  let subtotal = 0;
  let totalDiscount = 0;
  let totalGst = 0;

  const normalized =
    items.map(item => {
      const id =
        String(item.id);

      const qty =
        Number(item.qty);

      if (
        !Number.isInteger(qty) ||
        qty < 1 ||
        qty > 20
      ) {
        throw new Error(
          "Invalid quantity for product " +
          id
        );
      }

      const product =
        productMap.get(id);

      if (!product) {
        throw new Error(
          "Product is unavailable or inactive: " +
          id
        );
      }

      const price =
        Number(product.price);

      if (
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw new Error(
          "Invalid price for product " +
          product.name
        );
      }

      /*
        No MRP/discount field currently exists
        in the products table.

        Therefore current discount = 0.
      */
      const mrp = price;
      const discount = 0;

      const taxableAmount =
        Math.max(
          0,
          mrp - discount
        ) * qty;

      const gstRate =
        Number(
          GST_RATES[
            Number(product.id)
          ]
        );

      if (
        !Number.isFinite(gstRate) ||
        gstRate < 0
      ) {
        throw new Error(
          "GST rate is not configured for product " +
          product.id
        );
      }

      /*
        Calculate GST in paise-safe precision.
      */
      const gstAmount =
        Math.round(
          taxableAmount *
          gstRate /
          100 *
          100
        ) / 100;

      const lineTotal =
        taxableAmount +
        gstAmount;

      subtotal +=
        taxableAmount;

      totalDiscount +=
        discount * qty;

      totalGst +=
        gstAmount;

      return {
        id: product.id,

        qty,

        name:
          product.name,

        category:
          product.category,

        image_url:
          product.image_url,

        mrp,

        discount,

        unit_price:
          price,

        gst_rate:
          gstRate,

        gst_amount:
          gstAmount,

        taxable_amount:
          taxableAmount,

        line_total:
          lineTotal
      };
    });

  /*
    Free delivery at/above ₹599.
    Otherwise delivery = ₹49.
  */
  const delivery =
    subtotal >= DELIVERY_THRESHOLD
      ? 0
      : DELIVERY_BELOW_THRESHOLD;

  /*
    No additional miscellaneous charge
    is currently configured.
  */
  const otherCharges = 0;

  const finalAmount =
    subtotal -
    totalDiscount +
    totalGst +
    delivery +
    otherCharges;

  if (
    !Number.isFinite(finalAmount) ||
    finalAmount < 1
  ) {
    throw new Error(
      "Invalid order amount"
    );
  }

  /*
    Round all monetary values to two decimals.
  */
  const roundMoney =
    value =>
      Math.round(
        Number(value) * 100
      ) / 100;

  return {
    items:
      normalized,

    subtotal:
      roundMoney(subtotal),

    discount:
      roundMoney(totalDiscount),

    gst:
      roundMoney(totalGst),

    delivery:
      roundMoney(delivery),

    other_charges:
      roundMoney(otherCharges),

    total:
      roundMoney(finalAmount)
  };
}

module.exports = {
  KEY_ID,
  KEY_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,

  cors,
  json,
  readBody,
  basicAuth,
  getSupabaseUser,
  getProductsByIds,
  calculate
};
