# Settlement field mapping

Resolved UPI MDR belongs in the existing seller settlement `payment_fee_amount` / payment-processing deduction component. It must not be added to `platform_commission_amount` or `commission_gst_amount`.

Net seller payable continues to subtract the existing settlement components exactly once: platform commission, commission GST, payment processing, shipping, return/RTO, other deductions and refunds.
