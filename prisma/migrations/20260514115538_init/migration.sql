-- CreateEnum
CREATE TYPE "GenderEnum" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "CategoryEnum" AS ENUM ('TRADER', 'FREELANCER', 'EMPLOYEE', 'STUDENT', 'SMALL_BUSINESS_OWNER');

-- CreateEnum
CREATE TYPE "RoleEnum" AS ENUM ('ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "BankAccountProviderEnum" AS ENUM ('SQUAD');

-- CreateEnum
CREATE TYPE "TransactionDirectionEnum" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "TransactionStatusEnum" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "TransactionCategoryEnum" AS ENUM ('INCOME', 'TRANSFER', 'FOOD_AND_DINING', 'TRANSPORT', 'BILLS_AND_UTILITIES', 'SHOPPING', 'ENTERTAINMENT', 'HEALTH', 'EDUCATION', 'SAVINGS', 'INVESTMENT', 'FEES', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletPocketTypeEnum" AS ENUM ('SPEND', 'SAVE', 'GOAL');

-- CreateEnum
CREATE TYPE "LoanProductTypeEnum" AS ENUM ('PERSONAL', 'SALARY_ADVANCE', 'BUSINESS', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "LoanTierEnum" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "LoanApplicationStatusEnum" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'DISBURSED', 'REPAID', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "InvestmentProductTypeEnum" AS ENUM ('MONEY_MARKET', 'TREASURY_BILL', 'BOND', 'COOPERATIVE', 'ETF', 'FIXED_DEPOSIT');

-- CreateEnum
CREATE TYPE "RiskLevelEnum" AS ENUM ('LOW', 'LOW_MEDIUM', 'MEDIUM', 'MEDIUM_HIGH', 'HIGH');

-- CreateEnum
CREATE TYPE "InvestmentAllocationStatusEnum" AS ENUM ('PENDING', 'ACTIVE', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "OpportunityKindEnum" AS ENUM ('GRANT', 'PARTNERSHIP');

-- CreateEnum
CREATE TYPE "OpportunitySourceEnum" AS ENUM ('LOAN', 'INVESTMENT', 'GRANT');

-- CreateEnum
CREATE TYPE "CopilotRoleEnum" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_phone_number_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_account_creation_completed" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMP(3),
    "phone_number_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "middle_name" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "bvn" VARCHAR(11),
    "nin" VARCHAR(11),
    "phone_number" VARCHAR(15),
    "profession" "CategoryEnum",
    "address" TEXT,
    "gender" "GenderEnum",
    "role" "RoleEnum" NOT NULL DEFAULT 'USER',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "account_number" VARCHAR(10) NOT NULL,
    "account_name" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "customer_identifier" TEXT NOT NULL,
    "beneficiary_account" VARCHAR(10),
    "provider" "BankAccountProviderEnum" NOT NULL DEFAULT 'SQUAD',
    "balance" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "provider_reference" TEXT,
    "direction" "TransactionDirectionEnum" NOT NULL,
    "status" "TransactionStatusEnum" NOT NULL DEFAULT 'PENDING',
    "category" "TransactionCategoryEnum" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER NOT NULL DEFAULT 0,
    "principal_amount" INTEGER,
    "settled_amount" INTEGER,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
    "sender_name" TEXT,
    "sender_account_number" VARCHAR(20),
    "sender_bank_code" TEXT,
    "sender_bank_name" TEXT,
    "recipient_name" TEXT,
    "recipient_account_number" VARCHAR(20),
    "recipient_bank_code" TEXT,
    "recipient_bank_name" TEXT,
    "remark" TEXT,
    "provider" "BankAccountProviderEnum" NOT NULL DEFAULT 'SQUAD',
    "metadata" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_pockets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "WalletPocketTypeEnum" NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "target_amount" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "account_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_pockets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" "LoanProductTypeEnum" NOT NULL,
    "interest_rate_bps" INTEGER NOT NULL,
    "min_amount" INTEGER NOT NULL,
    "max_amount" INTEGER NOT NULL,
    "min_tenor_days" INTEGER NOT NULL,
    "max_tenor_days" INTEGER NOT NULL,
    "required_tier" "LoanTierEnum" NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_applications" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "requested_amount" INTEGER NOT NULL,
    "approved_amount" INTEGER,
    "tenor_days" INTEGER NOT NULL,
    "status" "LoanApplicationStatusEnum" NOT NULL DEFAULT 'PENDING',
    "rejection_reason" TEXT,
    "decisioned_at" TIMESTAMP(3),
    "disbursed_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" "InvestmentProductTypeEnum" NOT NULL,
    "expected_return_bps" INTEGER NOT NULL,
    "risk_level" "RiskLevelEnum" NOT NULL,
    "min_amount" INTEGER NOT NULL,
    "tenor_days" INTEGER,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investment_allocations" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "current_value" INTEGER NOT NULL,
    "status" "InvestmentAllocationStatusEnum" NOT NULL DEFAULT 'PENDING',
    "allocated_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "matures_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grants" (
    "id" UUID NOT NULL,
    "kind" "OpportunityKindEnum" NOT NULL,
    "title" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "award_amount" INTEGER NOT NULL,
    "deadline" TIMESTAMP(3),
    "eligibility" TEXT NOT NULL,
    "application_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_opportunities" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "OpportunitySourceEnum" NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "saved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CopilotRoleEnum" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_bvn_key" ON "users"("bvn");

-- CreateIndex
CREATE UNIQUE INDEX "users_nin_key" ON "users"("nin");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_number_key" ON "users"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_account_number_key" ON "bank_accounts"("account_number");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_customer_identifier_key" ON "bank_accounts"("customer_identifier");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_provider_reference_key" ON "transactions"("provider_reference");

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_account_id_created_at_idx" ON "transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "transactions_direction_status_idx" ON "transactions"("direction", "status");

-- CreateIndex
CREATE INDEX "wallet_pockets_user_id_idx" ON "wallet_pockets"("user_id");

-- CreateIndex
CREATE INDEX "loan_applications_user_id_status_idx" ON "loan_applications"("user_id", "status");

-- CreateIndex
CREATE INDEX "investment_allocations_user_id_status_idx" ON "investment_allocations"("user_id", "status");

-- CreateIndex
CREATE INDEX "saved_opportunities_user_id_idx" ON "saved_opportunities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "saved_opportunities_user_id_source_opportunity_id_key" ON "saved_opportunities"("user_id", "source", "opportunity_id");

-- CreateIndex
CREATE INDEX "copilot_messages_user_id_created_at_idx" ON "copilot_messages"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pockets" ADD CONSTRAINT "wallet_pockets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_pockets" ADD CONSTRAINT "wallet_pockets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "loan_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_applications" ADD CONSTRAINT "loan_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_allocations" ADD CONSTRAINT "investment_allocations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "investment_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investment_allocations" ADD CONSTRAINT "investment_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_opportunities" ADD CONSTRAINT "saved_opportunities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
