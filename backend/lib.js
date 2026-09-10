const crypto = require("crypto");

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const DELIVERY_THRESHOLD = 299;
const DELIVERY_BELOW_THRESHOLD = 49;
// Legacy fields are kept at zero so existing order/database integrations remain compatible
// while customers are no longer charged a separate payment-handling/COD fee.
const PAYMENT_HANDLING_FEE = 0;
const PREPAID_DISCOUNT = 0;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_CART_LINES = 50;
const MAX_ITEM_QUANTITY = 500;
const DEFAULT_ORIGIN = "https://praveens6050-afk.github.io";
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGIN || DEFAULT_ORIGIN)
  .split(",")
  .map(value => value.trim())
  .filter(Boolean);

const serverHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY
};

function applySecurityHeaders(res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function cors(req, res) {
  applySecurityHeaders(res);
  const origin = String(req?.headers?.origin || "").trim();
  const allowed = !origin || ALLOWED_ORIGINS.includes(origin);
  if (origin && allowed) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Razorpay-Signature");
  res.setHeader("Access-Control-Max-Age", "600");
  return allowed;
}

function json(req, res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  cors(req, res);
  res.end(JSON.stringify(body));
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    req.on("data", chunk => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_BODY_BYTES) {
        fail(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", fail);
  });
}

async function readBody(req) {
  const raw = await readRawBody(req);
  try { return JSON.parse(raw.toString("utf8") || "{}"); }
  catch { throw new Error("Invalid JSON body"); }
}

function basicAuth() {
  return "Basic " + Buffer.from(KEY_ID + ":" + KEY_SECRET).toString("base64");
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePaymentMethod(value) {
  const method = String(value || "prepaid").trim().toLowerCase();
  if (!['prepaid', 'cod'].includes(method)) throw new Error("Invalid payment method");
  return method;
}

function paymentPricing(basePayable, paymentMethod) {
  const method = normalizePaymentMethod(paymentMethod);
  const total = roundMoney(Math.max(0, Number(basePayable || 0)));
  return {
    payment_method: method,
    payment_handling_fee: 0,
    prepaid_discount: 0,
    cod_fee: 0,
    cod_fee_non_refundable: false,
    total
  };
}

function assertServerConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase server configuration is missing");
  }
}

async function getSupabaseUser(req) {
  assertServerConfig();
  const origin = String(req?.headers?.origin || "").trim();
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    const error = new Error("Origin not allowed");
    error.status = 403;
    throw error;
  }
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
    throw new Error("Please log in before checkout");
  }
  const accessToken = String(authHeader).substring(7).trim();
  const response = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + accessToken }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) {
    throw new Error("Your login session has expired. Please log in again.");
  }
  return data;
}

async function requireAdminUser(req) {
  const user = await getSupabaseUser(req);
  const response = await fetch(
    SUPABASE_URL + "/rest/v1/profiles?id=eq." + encodeURIComponent(user.id) + "&select=id,is_admin&limit=1",
    { headers: serverHeaders }
  );
  const rows = await response.json().catch(() => []);
  if (!response.ok || !rows?.[0]?.is_admin) {
    const error = new Error("Administrator access is required");
    error.status = 403;
    throw error;
  }
  return user;
}

async function getProductsByIds(ids) {
  assertServerConfig();
  if (!Array.isArray(ids) || !ids.length) throw new Error("Cart is empty");
  const cleanIds = ids.map(id => {
    const value = String(id).trim();
    if (!/^\d+$/.test(value)) throw new Error("Invalid product ID");
    return value;
  });
  const uniqueIds = [...new Set(cleanIds)];
  const url = SUPABASE_URL +
    "/rest/v1/products?id=in.(" + uniqueIds.join(",") + ")" +
    "&is_active=eq.true&select=id,name,category,price,image_url,gst_rate";
  const response = await fetch(url, { headers: serverHeaders });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.message || "Could not load products from Supabase");
  return Array.isArray(data) ? data : [];
}

function normalizeCartRequest(items) {
  if (!Array.isArray(items) || !items.length) throw new Error("Cart is empty");
  if (items.length > MAX_CART_LINES) throw new Error("Too many cart items");
  const seen = new Set();
  return items.map(item => {
    const id = String(item?.id ?? "").trim();
    const qty = Number(item?.qty);
    if (!/^\d+$/.test(id)) throw new Error("Invalid product ID");
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
      throw new Error("Invalid quantity for product " + id);
    }
    if (seen.has(id)) throw new Error("Duplicate product ID: " + id);
    seen.add(id);
    return { id, qty };
  });
}

async function calculate(items) {
  const requested = normalizeCartRequest(items);
  const ids = requested.map(item => item.id);
  const products = await getProductsByIds(ids);
  const productMap = new Map(products.map(product => [String(product.id), product]));
  let subtotal = 0;
  let totalDiscount = 0;
  let totalGst = 0;
  const normalized = requested.map(item => {
    const id = item.id;
    const qty = item.qty;
    const product = productMap.get(id);
    if (!product) throw new Error("Product is unavailable or inactive: " + id);
    const price = Number(product.price);
    const gstRate = Number(product.gst_rate);
    if (!Number.isFinite(price) || price <= 0) throw new Error("Invalid price for product " + product.name);
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) throw new Error("GST rate is not configured for product " + product.id);
    const mrp = price;
    const discount = 0;
    const taxableAmount = roundMoney(Math.max(0, mrp - discount) * qty);
    const gstAmount = roundMoney(taxableAmount * gstRate / 100);
    const lineTotal = roundMoney(taxableAmount + gstAmount);
    subtotal += taxableAmount;
    totalDiscount += discount * qty;
    totalGst += gstAmount;
    return {
      id: product.id, qty, name: product.name, category: product.category, image_url: product.image_url,
      mrp, discount, unit_price: price, gst_rate: gstRate, gst_amount: gstAmount,
      taxable_amount: taxableAmount, line_total: lineTotal
    };
  });
  const delivery = subtotal >= DELIVERY_THRESHOLD ? 0 : DELIVERY_BELOW_THRESHOLD;
  const otherCharges = 0;
  const baseTotal = roundMoney(subtotal - totalDiscount + totalGst + delivery + otherCharges);
  if (!Number.isFinite(baseTotal) || baseTotal < 0) throw new Error("Invalid order amount");
  return {
    items: normalized,
    subtotal: roundMoney(subtotal),
    discount: roundMoney(totalDiscount),
    gst: roundMoney(totalGst),
    delivery: roundMoney(delivery),
    delivery_threshold: DELIVERY_THRESHOLD,
    delivery_non_refundable: delivery > 0,
    amount_to_delivery_benefit: roundMoney(Math.max(0, DELIVERY_THRESHOLD - subtotal)),
    other_charges: roundMoney(otherCharges),
    total: baseTotal
  };
}

module.exports = {
  KEY_ID, KEY_SECRET, WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  DELIVERY_THRESHOLD, DELIVERY_BELOW_THRESHOLD, PAYMENT_HANDLING_FEE, PREPAID_DISCOUNT,
  MAX_BODY_BYTES, MAX_CART_LINES, MAX_ITEM_QUANTITY, serverHeaders, applySecurityHeaders, cors, json,
  readRawBody, readBody, basicAuth, safeEqualText, roundMoney, normalizePaymentMethod,
  paymentPricing, normalizeCartRequest, getSupabaseUser, requireAdminUser, getProductsByIds, calculate
};
