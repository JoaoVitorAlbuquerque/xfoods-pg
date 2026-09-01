-- CreateEnum
CREATE TYPE "costing_method" AS ENUM ('LAST_PURCHASE', 'AVERAGE', 'FIFO', 'BY_BATCH');

-- CreateEnum
CREATE TYPE "purchase_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "cost_source" AS ENUM ('PURCHASE', 'MANUAL', 'ADJUSTMENT');

-- AlterTable
ALTER TABLE "supplies" ADD COLUMN     "costing_method" "costing_method" NOT NULL DEFAULT 'LAST_PURCHASE',
ADD COLUMN     "last_purchase_at" TIMESTAMP(3),
ADD COLUMN     "last_purchase_unit_id" UUID,
ADD COLUMN     "last_purchase_unit_price" DECIMAL(14,6),
ADD COLUMN     "last_supplier_id" UUID;

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "document_number" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "total_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "purchase_status" NOT NULL DEFAULT 'DRAFT',
    "confirmed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "supply_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantity_base" DECIMAL(18,6) NOT NULL,
    "unit_price" DECIMAL(14,6) NOT NULL,
    "total_price" DECIMAL(14,4) NOT NULL,
    "unit_cost_base" DECIMAL(14,6) NOT NULL,
    "batch" TEXT,
    "expires_at" TIMESTAMP(3),
    "movement_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_cost_history" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supply_id" UUID NOT NULL,
    "unit_cost_base" DECIMAL(14,6) NOT NULL,
    "previous_unit_cost_base" DECIMAL(14,6),
    "variation_percent" DECIMAL(12,4),
    "unit_price" DECIMAL(14,6) NOT NULL,
    "unit_id" UUID NOT NULL,
    "source" "cost_source" NOT NULL DEFAULT 'PURCHASE',
    "purchase_item_id" UUID,
    "supplier_id" UUID,
    "effective_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_cost_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_user_id_idx" ON "suppliers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_user_id_name_key" ON "suppliers"("user_id", "name");

-- CreateIndex
CREATE INDEX "purchases_user_id_issued_at_idx" ON "purchases"("user_id", "issued_at");

-- CreateIndex
CREATE INDEX "purchases_user_id_status_idx" ON "purchases"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_movement_id_key" ON "purchase_items"("movement_id");

-- CreateIndex
CREATE INDEX "purchase_items_supply_id_idx" ON "purchase_items"("supply_id");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "supply_cost_history_purchase_item_id_key" ON "supply_cost_history"("purchase_item_id");

-- CreateIndex
CREATE INDEX "supply_cost_history_user_id_supply_id_effective_at_idx" ON "supply_cost_history"("user_id", "supply_id", "effective_at");

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_last_supplier_id_fkey" FOREIGN KEY ("last_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_last_purchase_unit_id_fkey" FOREIGN KEY ("last_purchase_unit_id") REFERENCES "measurement_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_cost_history" ADD CONSTRAINT "supply_cost_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_cost_history" ADD CONSTRAINT "supply_cost_history_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_cost_history" ADD CONSTRAINT "supply_cost_history_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_cost_history" ADD CONSTRAINT "supply_cost_history_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_cost_history" ADD CONSTRAINT "supply_cost_history_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
