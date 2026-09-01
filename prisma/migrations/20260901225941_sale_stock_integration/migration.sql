-- AlterTable
ALTER TABLE "stock_settings" ADD COLUMN     "allow_sale_without_recipe" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "recipe_size_factors" (
    "id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "size" "size_type" NOT NULL,
    "factor" DECIMAL(10,4) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_size_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recipe_size_factors_recipe_id_size_key" ON "recipe_size_factors"("recipe_id", "size");

-- AddForeignKey
ALTER TABLE "recipe_size_factors" ADD CONSTRAINT "recipe_size_factors_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
