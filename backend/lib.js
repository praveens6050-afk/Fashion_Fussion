const crypto = require("crypto");

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

function cors(res) {
  const origin = process.env.ALLOWED_ORIGIN || "*";

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

/*
  Get the currently logged-in Supabase user.

  The frontend sends:
  Authorization: Bearer <supabase access token>
*/
async function getSupabaseUser(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
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
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization:
          "Bearer " + accessToken
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.id) {
    throw new Error(
      "Your login session has expired. Please log in again."
    );
  }

  return data;
}

/*
  Fetch active products from Supabase.

  IMPORTANT:
  Price is taken from Supabase, not from the browser.
*/
async function getProductsByIds(ids) {
  if (
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error(
      "Supabase server configuration is missing"
    );
  }

  if (!Array.isArray(ids) || !ids.length) {
    throw new Error("Cart is empty");
  }

  const cleanIds = ids.map(id => {
    const value = String(id).trim();

    if (!/^\d+$/.test(value)) {
      throw new Error("Invalid product ID");
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

  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization:
        "Bearer " +
        SUPABASE_SERVICE_ROLE_KEY
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data?.message ||
      "Could not load products from Supabase"
    );
  }

  return data;
}

/*
  Server-side cart calculation.

  NEVER trust the price sent by the browser.
*/
async function calculate(items) {
  if (
    !Array.isArray(items) ||
    !items.length
  ) {
    throw new Error("Cart is empty");
  }

  const ids = items.map(item => item.id);

  const products =
    await getProductsByIds(ids);

  const productMap = new Map(
    products.map(product => [
      String(product.id),
      product
    ])
  );

  let total = 0;

  const normalized = items.map(item => {
    const id = String(item.id);

    const qty = Number(item.qty);

    if (
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > 20
    ) {
      throw new Error(
        "Invalid quantity for product " + id
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

    const lineTotal =
      price * qty;

    total += lineTotal;

    return {
      id: product.id,
      qty,
      name: product.name,
      category: product.category,
      image_url: product.image_url,
      unit_price: price,
      line_total: lineTotal
    };
  });

  if (
    !Number.isFinite(total) ||
    total < 1
  ) {
    throw new Error(
      "Invalid order amount"
    );
  }

  return {
    items: normalized,
    total
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
