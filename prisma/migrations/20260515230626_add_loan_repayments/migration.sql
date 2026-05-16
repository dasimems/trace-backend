-- CreateEnum
CREATE TYPE "LoanRepaymentCadenceEnum" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'BULLET');

-- CreateEnum
CREATE TYPE "LoanRepaymentStatusEnum" AS ENUM ('PENDING', 'DUE', 'PAID');

-- AlterTable
ALTER TABLE "loan_products"
    ADD COLUMN "repayment_cadence" "LoanRepaymentCadenceEnum" NOT NULL DEFAULT 'WEEKLY';

-- AlterTable
ALTER TABLE "loan_applications"
    ADD COLUMN "interest_rate_bps" INTEGER,
    ADD COLUMN "total_interest" INTEGER,
    ADD COLUMN "total_repayment" INTEGER,
    ADD COLUMN "repaid_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "principal_amount" INTEGER NOT NULL,
    "interest_amount" INTEGER NOT NULL,
    "total_amount" INTEGER NOT NULL,
    "paid_amount" INTEGER NOT NULL DEFAULT 0,
    "status" "LoanRepaymentStatusEnum" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayments_application_id_sequence_key" ON "loan_repayments"("application_id", "sequence");

-- CreateIndex
CREATE INDEX "loan_repayments_due_at_status_idx" ON "loan_repayments"("due_at", "status");

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "loan_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
