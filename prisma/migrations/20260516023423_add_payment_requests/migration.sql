-- CreateEnum
CREATE TYPE "PaymentRequestKindEnum" AS ENUM ('FUND', 'REQUEST');

-- CreateEnum
CREATE TYPE "PaymentRequestStatusEnum" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "payment_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "gateway_ref" TEXT,
    "kind" "PaymentRequestKindEnum" NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
    "status" "PaymentRequestStatusEnum" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "checkout_url" TEXT NOT NULL,
    "callback_url" TEXT,
    "payment_type" TEXT,
    "paid_by_email" TEXT,
    "paid_by_name" TEXT,
    "paid_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "transaction_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_reference_key" ON "payment_requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_requests_transaction_id_key" ON "payment_requests"("transaction_id");

-- CreateIndex
CREATE INDEX "payment_requests_user_id_status_created_at_idx" ON "payment_requests"("user_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "payment_requests_kind_status_idx" ON "payment_requests"("kind", "status");

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_requests" ADD CONSTRAINT "payment_requests_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
