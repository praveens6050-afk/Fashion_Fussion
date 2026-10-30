import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const webhook = readFileSync(new URL('../../supabase/functions/crm-inbound-webhook/index.ts', import.meta.url), 'utf8');
const media = readFileSync(new URL('../../supabase/functions/crm-whatsapp-media/index.ts', import.meta.url), 'utf8');
const inbox = readFileSync(new URL('../crm-unified-inbox.js', import.meta.url), 'utf8');
const supportInbox = readFileSync(new URL('../admin-crm-whatsapp-inbox.js', import.meta.url), 'utf8');

const allowedMimeTypes = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
];

test('webhook captures media id, MIME, filename, hash and caption without storing file bytes', () => {
  for (const field of ['media_id', 'mime_type', 'filename', 'sha256', 'caption', 'supported']) {
    assert.ok(webhook.includes(field), 'webhook must capture ' + field);
  }
  assert.ok(webhook.includes('metadata.whatsapp_attachment'));
  for (const mime of allowedMimeTypes) assert.ok(webhook.includes(mime), 'missing allowlisted MIME ' + mime);
});

test('attachment endpoint requires an authenticated user and an RLS-scoped message lookup', () => {
  assert.ok(media.includes('req.headers.get("Authorization")'));
  assert.ok(media.includes('userDb.auth.getUser(token)'));
  assert.ok(media.includes('userDb.from("crm_inbox_messages")'));
  assert.ok(media.includes('userDb.from("crm_inbox_conversations")'));
  assert.ok(media.includes('["whatsapp", "email"].includes(String(conversation.provider))'));
  assert.ok(media.includes('metadata.zoho_attachments'));
  assert.ok(media.includes('crm_get_zoho_mailbox_auth'));
});

test('attachment endpoint restricts MIME, download hosts and payload size', () => {
  for (const mime of allowedMimeTypes) assert.ok(media.includes(mime), 'missing allowlisted MIME ' + mime);
  assert.ok(media.includes('MAX_BYTES = 15 * 1024 * 1024'));
  assert.ok(media.includes('mediaUrl.protocol !== "https:"'));
  assert.ok(media.includes('parsedUrl.hostname.endsWith(".fbcdn.net")'));
  assert.ok(media.includes('"X-Content-Type-Options": "nosniff"'));
});

test('attachment text extraction is bounded and supports PDF, TXT, DOCX and spreadsheets', () => {
  assert.ok(media.includes('input?.action === "extract"'));
  assert.ok(media.includes('pdfjs-dist'));
  assert.ok(media.includes('mammoth'));
  assert.ok(media.includes('xlsx@'));
  assert.ok(media.includes('const limit = 200000'));
  assert.ok(media.includes('Math.min(pdf.numPages, 100)'));
});

test('CRM inbox requests attachment metadata and exposes authenticated read controls', () => {
  assert.ok(inbox.includes('provider_message_id,metadata'));
  assert.ok(inbox.includes('crm-wa-attachment-open'));
  assert.ok(inbox.includes("action:'extract'"));
  assert.ok(inbox.includes("'preview':'download'"));
  assert.ok(inbox.includes('getSession()'));
});


test('active CRM WhatsApp Support Inbox loads scoped message history and renders attachment controls', () => {
  assert.ok(supportInbox.includes("db.from('crm_inbox_messages')"), 'active WhatsApp inbox must load message history');
  assert.ok(supportInbox.includes(".eq('conversation_id',id)"), 'message history must be scoped to the selected conversation');
  assert.ok(supportInbox.includes('metadata.whatsapp_attachment') || supportInbox.includes('meta.whatsapp_attachment'), 'attachment metadata must be inspected');
  assert.ok(supportInbox.includes('Open / read attachment'));
  assert.ok(supportInbox.includes('Read image text / OTP'));
  assert.ok(supportInbox.includes('Attachment reference missing'), 'missing media IDs must be explained rather than silently hiding controls');
  assert.ok(supportInbox.includes('crm-whatsapp-media'), 'attachment fetch must use the authenticated media endpoint');
});
