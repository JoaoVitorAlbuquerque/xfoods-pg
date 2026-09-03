-- CreateEnum
CREATE TYPE "production_status" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELED');

-- AlterEnum
ALTER TYPE "cost_source" ADD VALUE 'PRODUCTION';

-- AlterTable
ALTER TABLE "recipes" ADD COLUMN     "output_supply_id" UUID;

-- CreateTable
CREATE TABLE "production_orders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "output_supply_id" UUID NOT NULL,
    "status" "production_status" NOT NULL DEFAULT 'DRAFT',
    "batches" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "expected_quantity" DECIMAL(18,6) NOT NULL,
    "actual_quantity" DECIMAL(18,6) NOT NULL,
    "yield_difference" DECIMAL(18,6) NOT NULL,
    "yield_percent" DECIMAL(12,4),
    "total_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "produced_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "output_movement_id" UUID,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_items" (
    "id" UUID NOT NULL,
    "production_order_id" UUID NOT NULL,
    "supply_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantity_base" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "movement_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_output_movement_id_key" ON "production_orders"("output_movement_id");

-- CreateIndex
CREATE INDEX "production_orders_user_id_produced_at_idx" ON "production_orders"("user_id", "produced_at");

-- CreateIndex
CREATE INDEX "production_orders_user_id_status_idx" ON "production_orders"("user_id", "status");

-- CreateIndex
CREATE INDEX "production_orders_output_supply_id_idx" ON "production_orders"("output_supply_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_order_items_movement_id_key" ON "production_order_items"("movement_id");

-- CreateIndex
CREATE INDEX "production_order_items_production_order_id_idx" ON "production_order_items"("production_order_id");

-- CreateIndex
CREATE INDEX "production_order_items_supply_id_idx" ON "production_order_items"("supply_id");

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_output_supply_id_fkey" FOREIGN KEY ("output_supply_id") REFERENCES "supplies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_output_supply_id_fkey" FOREIGN KEY ("output_supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_output_movement_id_fkey" FOREIGN KEY ("output_movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_production_order_id_fkey" FOREIGN KEY ("production_order_id") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;
