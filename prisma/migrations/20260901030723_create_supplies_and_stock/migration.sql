-- CreateEnum
CREATE TYPE "stock_movement_type" AS ENUM ('PURCHASE', 'SALE', 'LOSS', 'ADJUSTMENT', 'PRODUCTION', 'RETURN', 'TRANSFER');

-- CreateEnum
CREATE TYPE "stock_count_status" AS ENUM ('OPEN', 'APPLIED', 'CANCELED');

-- CreateTable
CREATE TABLE "supply_categories" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplies" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supply_category_id" UUID,
    "base_unit_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "current_stock" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "min_stock" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "max_stock" DECIMAL(18,6),
    "average_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "last_cost" DECIMAL(14,6),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supply_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "type" "stock_movement_type" NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "quantity_base" DECIMAL(18,6) NOT NULL,
    "unit_cost" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "total_cost" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "balance_after" DECIMAL(18,6) NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_counts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "stock_count_status" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_count_items" (
    "id" UUID NOT NULL,
    "stock_count_id" UUID NOT NULL,
    "supply_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "counted_quantity" DECIMAL(18,6) NOT NULL,
    "counted_quantity_base" DECIMAL(18,6) NOT NULL,
    "system_quantity_base" DECIMAL(18,6),
    "difference_base" DECIMAL(18,6),
    "movement_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "allow_negative_stock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supply_categories_user_id_idx" ON "supply_categories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "supply_categories_user_id_name_key" ON "supply_categories"("user_id", "name");

-- CreateIndex
CREATE INDEX "supplies_user_id_active_idx" ON "supplies"("user_id", "active");

-- CreateIndex
CREATE INDEX "supplies_supply_category_id_idx" ON "supplies"("supply_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplies_user_id_name_key" ON "supplies"("user_id", "name");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_supply_id_occurred_at_idx" ON "stock_movements"("user_id", "supply_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_type_idx" ON "stock_movements"("user_id", "type");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_counts_user_id_status_idx" ON "stock_counts"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_movement_id_key" ON "stock_count_items"("movement_id");

-- CreateIndex
CREATE INDEX "stock_count_items_supply_id_idx" ON "stock_count_items"("supply_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_count_items_stock_count_id_supply_id_key" ON "stock_count_items"("stock_count_id", "supply_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_settings_user_id_key" ON "stock_settings"("user_id");

-- AddForeignKey
ALTER TABLE "supply_categories" ADD CONSTRAINT "supply_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_supply_category_id_fkey" FOREIGN KEY ("supply_category_id") REFERENCES "supply_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplies" ADD CONSTRAINT "supplies_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_stock_count_id_fkey" FOREIGN KEY ("stock_count_id") REFERENCES "stock_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_supply_id_fkey" FOREIGN KEY ("supply_id") REFERENCES "supplies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "measurement_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_count_items" ADD CONSTRAINT "stock_count_items_movement_id_fkey" FOREIGN KEY ("movement_id") REFERENCES "stock_movements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_settings" ADD CONSTRAINT "stock_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
