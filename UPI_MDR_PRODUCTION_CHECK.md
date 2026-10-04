# Production verification

After deployment verify:
- database functions exist with expected signatures;
- anon/authenticated cannot execute them;
- service backend can resolve ₹5,000 eligible UPI to ₹20 when provider fee is absent;
- provider actual fee overrides estimate;
- customer checkout before/after has identical payable amount;
- seller settlement stores payment processing separately;
- no duplicate MDR appears after provider reconciliation.
