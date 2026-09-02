-- CreateEnum
CREATE TYPE "expense_type" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "expense_recurrence" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "cost_nature" AS ENUM ('DIRECT', 'INDIRECT');

-- CreateEnum
CREATE TYPE "allocation_method" AS ENUM ('PER_SOLD_UNIT', 'BY_REVENUE', 'MANUAL');

-- CreateEnum
CREATE TYPE "allocation_period" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nature" "cost_nature" NOT NULL DEFAULT 'INDIRECT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "expense_category_id" UUID,
    "description" TEXT NOT NULL,
    "type" "expense_type" NOT NULL DEFAULT 'FIXED',
    "recurrence" "expense_recurrence" NOT NULL DEFAULT 'MONTHLY',
    "amount" DECIMAL(14,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMP(3),
    "include_in_allocation" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_allocation_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" "allocation_method" NOT NULL DEFAULT 'PER_SOLD_UNIT',
    "reference_period" "allocation_period" NOT NULL DEFAULT 'MONTHLY',
    "estimated_sales_units" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "estimated_revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "include_fixed" BOOLEAN NOT NULL DEFAULT true,
    "include_variable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_allocation_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_categories_user_id_idx" ON "expense_categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_user_id_name_key" ON "expense_categories"("user_id", "name");

-- CreateIndex
CREATE INDEX "expenses_user_id_active_idx" ON "expenses"("user_id", "active");

-- CreateIndex
CREATE INDEX "expenses_user_id_start_date_idx" ON "expenses"("user_id", "start_date");

-- CreateIndex
CREATE INDEX "expenses_expense_category_id_idx" ON "expenses"("expense_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "cost_allocation_settings_user_id_key" ON "cost_allocation_settings"("user_id");

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_allocation_settings" ADD CONSTRAINT "cost_allocation_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
