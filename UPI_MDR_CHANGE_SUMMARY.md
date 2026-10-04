# UPI MDR change summary

This branch introduces merchant-side UPI MDR accounting without changing customer prices.

The database helper calculates 0.4% only for eligible UPI payments above ₹2,000 from 15 October 2026 IST, capped at ₹300. A second resolver prefers actual payment-provider fees and only estimates MDR when no actual provider fee is supplied, preventing duplicate deductions.

The existing seller settlement model already has a payment-processing-fee component; integration should feed the resolver output into that component. Marketplace commission remains independent, including LaunchPad 0% commission periods.

No customer checkout surcharge is introduced by this change.
