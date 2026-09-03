-- CreateIndex
CREATE INDEX "product_order_user_id_product_id_idx" ON "product_order"("user_id", "product_id");

-- CreateIndex
CREATE INDEX "stock_movements_user_id_occurred_at_idx" ON "stock_movements"("user_id", "occurred_at");
