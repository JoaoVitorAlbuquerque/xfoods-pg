-- CreateTable
CREATE TABLE "pricing_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "desired_margin_percent" DECIMAL(7,4) NOT NULL DEFAULT 30,
    "tax_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "card_fee_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "delivery_fee_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "other_fees_percent" DECIMAL(7,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pricing_settings_user_id_key" ON "pricing_settings"("user_id");

-- AddForeignKey
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
