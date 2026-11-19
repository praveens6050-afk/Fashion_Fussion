export const AGENTS = [
  { id: "customer_support", name: "Customer Support", scope: "Customer questions, order lookups, support triage and agent handoff", defaultMode: "assist" },
  { id: "seller_management", name: "Seller Management", scope: "Seller onboarding, listing guidance, compliance task tracking and seller support", defaultMode: "assist" },
  { id: "sales_conversion", name: "Sales & Conversion", scope: "Product discovery, recommendations, cart recovery analysis and conversion assistance", defaultMode: "assist" },
  { id: "order_backend", name: "Order & Backend Operations", scope: "Order status, inventory coordination, exception detection and operational workflows", defaultMode: "assist" },
  { id: "marketing", name: "Marketing", scope: "Campaign planning, audience insights, channel reporting and approved campaign execution", defaultMode: "assist" },
  { id: "content_creation", name: "Content Creation", scope: "Original fashion creatives, captions, product copy and duplicate-safe content planning", defaultMode: "assist" },
  { id: "lead_generation_followup", name: "Lead Generation & Follow-up", scope: "Seller prospecting, lead qualification, CRM updates and consent-aware follow-up drafts", defaultMode: "assist" },
  { id: "trust_fraud", name: "Trust, Verification & Fraud", scope: "Risk signals, duplicate-account detection and suspicious-activity review", defaultMode: "assist" },
  { id: "business_intelligence", name: "Business Intelligence", scope: "Sales, product, seller and campaign reporting with trend analysis", defaultMode: "assist" },
  { id: "voice_recruitment", name: "Voice & Recruitment", scope: "Inbound voice support, callback scheduling, job descriptions and candidate screening", defaultMode: "assist" }
];

export const SAFE_ACTIONS = new Set([
  "analyze", "classify", "draft", "summarize", "recommend", "report",
  "score_lead", "prepare_quote", "prepare_proposal", "triage",
  "generate_content", "plan_campaign", "screen_candidate",
  "lookup_order", "lookup_product", "prepare_follow_up"
]);

export const APPROVAL_ACTIONS = new Set([
  "issue_refund", "cancel_paid_order", "release_payout", "change_bank_account",
  "approve_seller", "reject_seller", "mark_kyc_verified", "suspend_account",
  "block_customer", "block_seller", "increase_ad_budget", "launch_paid_campaign",
  "send_bulk_message", "send_whatsapp_message", "send_customer_email",
  "send_outbound_call", "publish_social_post", "finalize_hiring", "create_payment_request"
]);

export const AGENT_ACTIONS = {
  customer_support: new Set(["analyze", "classify", "draft", "summarize", "triage", "lookup_order", "lookup_product", "prepare_follow_up", "send_whatsapp_message", "send_customer_email"]),
  seller_management: new Set(["analyze", "classify", "draft", "summarize", "triage", "prepare_proposal", "approve_seller", "reject_seller", "mark_kyc_verified", "change_bank_account"]),
  sales_conversion: new Set(["analyze", "draft", "recommend", "report", "lookup_order", "lookup_product", "prepare_quote", "create_payment_request"]),
  order_backend: new Set(["analyze", "summarize", "report", "lookup_order", "issue_refund", "cancel_paid_order", "release_payout"]),
  marketing: new Set(["analyze", "report", "plan_campaign", "generate_content", "increase_ad_budget", "launch_paid_campaign", "send_bulk_message"]),
  content_creation: new Set(["analyze", "draft", "summarize", "generate_content", "plan_campaign", "publish_social_post"]),
  lead_generation_followup: new Set(["analyze", "classify", "draft", "score_lead", "prepare_follow_up", "send_bulk_message", "send_whatsapp_message", "send_customer_email"]),
  trust_fraud: new Set(["analyze", "classify", "report", "score_lead", "suspend_account", "block_customer", "block_seller", "mark_kyc_verified"]),
  business_intelligence: new Set(["analyze", "report", "summarize"]),
  voice_recruitment: new Set(["classify", "draft", "summarize", "screen_candidate", "prepare_follow_up", "send_outbound_call", "send_customer_email", "finalize_hiring"])
};
