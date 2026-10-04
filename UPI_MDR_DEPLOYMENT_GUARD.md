# Deployment guard

Do not describe UPI MDR as production-active until both new database migrations have been applied successfully to production and the payment-provider settlement path supplies the required metadata. Repository merge alone is not sufficient for database activation.
