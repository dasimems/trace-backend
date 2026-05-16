-- CreateEnum
CREATE TYPE "InvestmentDistributionTypeEnum" AS ENUM ('DIVIDEND', 'INTEREST', 'CAPITAL_GAIN');

-- CreateEnum
CREATE TYPE "VirtualCardBrandEnum" AS ENUM ('VISA', 'VERVE', 'MASTERCARD');

-- CreateEnum
CREATE TYPE "VirtualCardStatusEnum" AS ENUM ('ACTIVE', 'FROZEN', 'TERMINATED');

-- CreateEnum
CREATE TYPE "UploadedDocumentCategoryEnum" AS ENUM ('IDENTITY', 'BUSINESS', 'FINANCIAL', 'COLLATERAL', 'OTHER');

-- AlterTable
ALTER TABLE "grants" ADD COLUMN     "faq_entries" JSONB,
ADD COLUMN     "required_documents" JSONB;

-- AlterTable
ALTER TABLE "investment_products" ADD COLUMN     "cost_breakdown_template" JSONB,
ADD COLUMN     "faq_entries" JSONB,
ADD COLUMN     "required_documents" JSONB,
ADD COLUMN     "risk_narrative" TEXT,
ADD COLUMN     "sector_allocation" JSONB;

-- AlterTable
ALTER TABLE "loan_products" ADD COLUMN     "cost_breakdown_template" JSONB,
ADD COLUMN     "faq_entries" JSONB,
ADD COLUMN     "required_documents" JSONB,
ADD COLUMN     "risk_narrative" TEXT;

-- CreateTable
CREATE TABLE "investment_nav_history" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "nav_per_unit" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_nav_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_distributions" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "amount_per_unit" INTEGER NOT NULL,
    "total_paid" INTEGER NOT NULL,
    "type" "InvestmentDistributionTypeEnum" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_distributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "virtual_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "last4" VARCHAR(4) NOT NULL,
    "brand" "VirtualCardBrandEnum" NOT NULL,
    "exp_month" INTEGER NOT NULL,
    "exp_year" INTEGER NOT NULL,
    "status" "VirtualCardStatusEnum" NOT NULL DEFAULT 'ACTIVE',
    "spend_limit_monthly" INTEGER NOT NULL,
    "spent_this_month" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_uploaded_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "OpportunitySourceEnum" NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "document_key" TEXT NOT NULL,
    "category" "UploadedDocumentCategoryEnum" NOT NULL,
    "file_url" TEXT,
    "file_name" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_uploaded_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investment_nav_history_product_id_date_idx" ON "investment_nav_history"("product_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "investment_nav_history_product_id_date_key" ON "investment_nav_history"("product_id", "date");

-- CreateIndex
CREATE INDEX "investment_distributions_product_id_paid_at_idx" ON "investment_distributions"("product_id", "paid_at");

-- CreateIndex
CREATE INDEX "virtual_cards_user_id_idx" ON "virtual_cards"("user_id");

-- CreateIndex
CREATE INDEX "user_uploaded_documents_user_id_source_opportunity_id_idx" ON "user_uploaded_documents"("user_id", "source", "opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_uploaded_documents_user_id_source_opportunity_id_docum_key" ON "user_uploaded_documents"("user_id", "source", "opportunity_id", "document_key");

-- AddForeignKey
ALTER TABLE "investment_nav_history" ADD CONSTRAINT "investment_nav_history_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_distributions" ADD CONSTRAINT "investment_distributions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_cards" ADD CONSTRAINT "virtual_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_cards" ADD CONSTRAINT "virtual_cards_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_uploaded_documents" ADD CONSTRAINT "user_uploaded_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
