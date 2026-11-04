(function () {
  'use strict';
  const form = document.getElementById('leadForm');
  if (!form) return;
  const button = document.getElementById('leadSubmit');
  const status = document.getElementById('leadStatus');
  let pendingLeadId = '';
  const params = new URLSearchParams(location.search);
  const interest = params.get('interest');
  if (interest) document.getElementById('leadInterest').value = interest.slice(0, 160);

  function setStatus(message, type) {
    status.textContent = message;
    status.className = 'status' + (type ? ' ' + type : '');
  }
  function getUtm(name) { return (params.get(name) || '').trim().slice(0, 120); }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (!form.reportValidity()) return;
    button.disabled = true;
    setStatus('Sending your enquiry…', '');
    try {
      await window.ffSupabaseReady;
      if (!pendingLeadId) pendingLeadId = crypto.randomUUID();
      const payload = {
        lead_id: pendingLeadId,
        name: document.getElementById('leadName').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        interest: document.getElementById('leadInterest').value.trim(),
        landing_page: params.get('landing_page') || location.href,
        utm_source: getUtm('utm_source'),
        utm_medium: getUtm('utm_medium'),
        utm_campaign: getUtm('utm_campaign'),
        utm_content: getUtm('utm_content'),
        whatsapp_enquiry_consent: document.getElementById('whatsappEnquiryConsent').checked,
        whatsapp_promo_consent: document.getElementById('whatsappPromoConsent').checked,
        company_website: document.getElementById('companyWebsite').value,
      };
      const { data, error } = await window.supabaseClient.functions.invoke('marketing-lead-intake', { body: payload });
      if (error || !data?.ok) throw error || new Error('Submission failed');
      pendingLeadId = '';
      form.reset();
      setStatus('Thank you. Our sales team has received your enquiry. WhatsApp follow-up will only happen if you selected that option.', 'success');
    } catch {
      setStatus('We could not confirm team delivery. Please try again; your enquiry will not be duplicated.', 'error');
    } finally {
      button.disabled = false;
    }
  });
})();

