-- Fase 1 · Fundação — 2/4: aditivo
--
-- Nada é removido e nada fica NOT NULL sem default. A aplicação anterior
-- continua funcionando com o banco neste estado.

-- ---------------------------------------------------------------------------
-- Papel do usuário
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'OWNER';

-- ---------------------------------------------------------------------------
-- Carimbos de tempo
-- Nenhum modelo tinha updated_at e só `orders` tinha created_at. Estoque e
-- custo exigem saber quando cada valor mudou.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "leads"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "categories"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ingredients"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "products"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "orders"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "product_order"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Dinheiro em Decimal
-- Float binário não representa decimais exatamente. Hoje o erro é invisível
-- porque só há soma; com custo médio, rateio e margem ele se acumula.
-- Os seis preços existentes cabem em 2 casas, então a conversão é exata.
-- ---------------------------------------------------------------------------
ALTER TABLE "products"
  ALTER COLUMN "price" TYPE DECIMAL(12,2) USING "price"::DECIMAL(12,2);

ALTER TABLE "products" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- Pedido: evento de venda datado
-- `paid` + `restarted` eram dois booleanos sem carimbo de tempo. `paid_at` é
-- o que passa a delimitar período em qualquer relatório de margem.
-- `stock_applied_at` é a trava de idempotência da baixa da Fase 5: ela só
-- executa enquanto o campo for nulo.
-- ---------------------------------------------------------------------------
ALTER TABLE "orders"
  ADD COLUMN "total_amount"     DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_at"          TIMESTAMP(3),
  ADD COLUMN "canceled_at"      TIMESTAMP(3),
  ADD COLUMN "deleted_at"       TIMESTAMP(3),
  ADD COLUMN "stock_applied_at" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- product_order: identidade própria
--
-- SQL escrito à mão de propósito. Trocar a chave primária via `prisma migrate
-- dev` faria o Prisma recriar a tabela e perder as 46 linhas existentes.
-- A PK composta (order_id, product_id) impedia vender o mesmo produto em dois
-- tamanhos no mesmo pedido e, principalmente, não dava id de linha para amarrar
-- um movimento de estoque a um item de venda.
-- ---------------------------------------------------------------------------
ALTER TABLE "product_order" ADD COLUMN "id" UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE "product_order" DROP CONSTRAINT "product_order_pkey";
ALTER TABLE "product_order" ADD CONSTRAINT "product_order_pkey" PRIMARY KEY ("id");

-- Preço congelado na venda. Nullable aqui; vira NOT NULL na parte 4/4,
-- depois do backfill.
ALTER TABLE "product_order"
  ADD COLUMN "unit_price"  DECIMAL(12,2),
  ADD COLUMN "total_price" DECIMAL(12,2);

-- ---------------------------------------------------------------------------
-- Índices
-- A PK composta cobria as buscas por order_id; sem ela, o índice é explícito.
-- ---------------------------------------------------------------------------
CREATE INDEX "product_order_order_id_idx"   ON "product_order"("order_id");
CREATE INDEX "product_order_product_id_idx" ON "product_order"("product_id");

CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");
CREATE INDEX "orders_user_id_restarted_idx"  ON "orders"("user_id", "restarted");
CREATE INDEX "orders_user_id_paid_at_idx"    ON "orders"("user_id", "paid_at");
CREATE INDEX "orders_lead_id_idx"            ON "orders"("lead_id");

CREATE INDEX "products_user_id_deleted_idx" ON "products"("user_id", "deleted");
CREATE INDEX "products_category_id_idx"     ON "products"("category_id");

CREATE INDEX "leads_user_id_idx"       ON "leads"("user_id");
CREATE INDEX "categories_user_id_idx"  ON "categories"("user_id");
CREATE INDEX "ingredients_user_id_idx" ON "ingredients"("user_id");
