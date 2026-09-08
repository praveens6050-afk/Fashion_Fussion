from pathlib import Path
import re


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def replace_once(text, old, new, label):
    count = text.count(old)
    require(count == 1, f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Homepage: permanent pricing / dispatch source fixes.
index_path = Path("index.html")
index = index_path.read_text(encoding="utf-8")
require("₹599" in index, "index: expected legacy ₹599 source text")
index = index.replace("₹599", "₹299")
require("Same-week dispatch" in index, "index: expected legacy dispatch wording")
index = index.replace("Same-week dispatch", "Dispatch within 3 days")
index, count = re.subn(
    r"const\s+DELIVERY_THRESHOLD\s*=\s*599\s*;",
    "const DELIVERY_THRESHOLD = 299;",
    index,
    count=1,
)
require(count == 1, f"index: expected one DELIVERY_THRESHOLD=599, found {count}")
require("₹599" not in index, "index: ₹599 remains")
require("Same-week dispatch" not in index, "index: old dispatch wording remains")
index_path.write_text(index, encoding="utf-8")


# Login: permanent brand source + direct checkout return.
login_path = Path("login.html")
login = login_path.read_text(encoding="utf-8")
login = replace_once(
    login,
    "Fashion<small>_FUSSION</small>",
    "Fashion_Fussion",
    "login branding",
)
login = replace_once(
    login,
    'window.location.href =\n            "index.html?checkout=1";',
    'window.location.href =\n            "checkout.html";',
    "checkout redirect",
)
login = login.replace(
    "return to index.html with a checkout\n         * flag.",
    "return directly to checkout.html.",
)
require("index.html?checkout=1" not in login, "login: old checkout redirect remains")
login_path.write_text(login, encoding="utf-8")


# Admin: permanent branding / links and database-driven GST.
admin_path = Path("admin.html")
admin = admin_path.read_text(encoding="utf-8")
admin = replace_once(admin, "<title>Fashion_FUSSION — Admin</title>", "<title>Fashion_Fussion — Admin</title>", "admin title")
admin = replace_once(admin, "Fashion<span>_FUSSION</span>", "Fashion<span>_Fussion</span>", "admin logo")
admin = replace_once(admin, '<a href="index.html">\n        Store', '<a href="index.html?admin_preview=1">\n        Store', "admin store link")
admin = replace_once(admin, '<a href="account.html">\n        My Account', '<a href="admin-account.html">\n        My Account', "admin account link")

legacy_gst = re.compile(
    r"/\*\n \* IMPORTANT GST CONFIGURATION.*?const GST_MAX_SUPPORTED_ID = 57;\n",
    re.S,
)
admin, count = legacy_gst.subn(
    "/*\n * GST is stored per product in public.products.gst_rate.\n * The backend and admin panel both use the same database value.\n */\n",
    admin,
    count=1,
)
require(count == 1, f"admin: expected legacy GST map block, found {count}")

old_get_gst = '''function getGSTRate(productId){\n\n  const id =\n    Number(productId);\n\n  return GST_RATES[id] ?? null;\n\n}'''
new_get_gst = '''function getGSTRate(product){\n\n  const rate =\n    Number(product?.gst_rate);\n\n  return (\n    Number.isFinite(rate) &&\n    rate >= 0 &&\n    rate <= 100\n  )\n    ? rate\n    : null;\n\n}'''
admin = replace_once(admin, old_get_gst, new_get_gst, "admin getGSTRate")
admin = admin.replace("getGSTRate(product.id)", "getGSTRate(product)")

status_pattern = re.compile(
    r"function updateGSTStatus\(\)\{.*?\n\}\n\n\n/\* =========================================================\n   DENY ACCESS",
    re.S,
)
new_status = '''function updateGSTStatus(){\n\n  const notice = $("gstNotice");\n  const coverage = $("gstCoverage");\n  const invalid = products.filter(product => getGSTRate(product) === null);\n\n  if(!invalid.length){\n    notice.className = "gst-notice gst-ok";\n    notice.innerHTML = `\n      <strong>GST coverage OK:</strong>\n      Every current product has a valid database GST rate.\n    `;\n    coverage.textContent = "✓ Configured";\n    coverage.style.color = "#2e7d32";\n    return;\n  }\n\n  notice.className = "gst-notice gst-warning";\n  notice.innerHTML = `\n    <strong>GST configuration warning:</strong>\n    ${invalid.length} product(s) need a valid GST rate between 0% and 100%.\n  `;\n  coverage.textContent = invalid.length + " Invalid";\n  coverage.style.color = "#e65100";\n\n}\n\n\n/* =========================================================\n   DENY ACCESS'''
admin, count = status_pattern.subn(new_status, admin, count=1)
require(count == 1, f"admin: expected GST status function, found {count}")

cost_anchor = '''          <div class="form-help">\n            Selling price is automatically calculated using the existing store formula.\n          </div>\n\n        </div>'''
gst_field = cost_anchor + '''\n\n\n        <!-- GST RATE -->\n\n        <div class="form-group">\n\n          <label for="productGstRate">\n            GST Rate %\n          </label>\n\n          <input\n            id="productGstRate"\n            type="number"\n            min="0"\n            max="100"\n            step="0.01"\n            value="18"\n            required\n          >\n\n          <div class="form-help">\n            Stored with the product and used by secure server pricing.\n          </div>\n\n        </div>'''
admin = replace_once(admin, cost_anchor, gst_field, "admin GST field")

admin = replace_once(
    admin,
    '''  $("productActive").value =\n    "true";''',
    '''  $("productActive").value =\n    "true";\n\n\n  $("productGstRate").value =\n    "18";''',
    "admin GST add default",
)
admin = replace_once(
    admin,
    '''  $("productDescription").value =\n    product.description ||\n    "";''',
    '''  $("productDescription").value =\n    product.description ||\n    "";\n\n\n  $("productGstRate").value =\n    product.gst_rate ??\n    "18";''',
    "admin GST edit value",
)

admin = replace_once(
    admin,
    '''  const description =\n    $("productDescription")\n      .value\n      .trim();''',
    '''  const description =\n    $("productDescription")\n      .value\n      .trim();\n\n\n  const gstRate =\n    Number(\n      $("productGstRate")\n        .value\n    );''',
    "admin GST parse",
)

reviews_validation = '''  if(\n    reviews < 0\n  ){\n\n    showStatus(\n      "Reviews cannot be negative.",\n      "error"\n    );\n\n    return;\n\n  }'''
admin = replace_once(
    admin,
    reviews_validation,
    reviews_validation + '''\n\n\n  if(\n    !Number.isFinite(gstRate) ||\n    gstRate < 0 ||\n    gstRate > 100\n  ){\n\n    showStatus(\n      "GST rate must be between 0 and 100.",\n      "error"\n    );\n\n    return;\n\n  }''',
    "admin GST validation",
)

limit_pattern = re.compile(
    r"\n\n  /\*\n   \* IMPORTANT:.*?\n  /\*\n   \* Product object",
    re.S,
)
admin, count = limit_pattern.subn("\n\n  /*\n   * Product object", admin, count=1)
require(count == 1, f"admin: expected ID-based GST limit block, found {count}")

admin = replace_once(
    admin,
    '''    description:\n      description\n\n  };''',
    '''    description:\n      description,\n\n    gst_rate:\n      gstRate\n\n  };''',
    "admin product GST payload",
)

require("GST_MAX_SUPPORTED_ID" not in admin, "admin: legacy GST max remains")
require("GST_RATES" not in admin, "admin: legacy GST map remains")
require('id="productGstRate"' in admin, "admin: GST input missing")
require('href="index.html?admin_preview=1"' in admin, "admin: preview link missing")
require('href="admin-account.html"' in admin, "admin: admin account link missing")
admin_path.write_text(admin, encoding="utf-8")

print("Guarded source fixes applied successfully.")
