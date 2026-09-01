-- Fase 1 · Fundação — 3/4: backfill
--
-- Migração separada de propósito: é a única que escreve em dados existentes,
-- e por isso precisa ser revisável e reversível de forma isolada.
--
-- PREMISSA ASSUMIDA: os preços dos produtos não mudaram desde as vendas já
-- registradas. É a única aproximação de todo o plano da Fase 1. Ela existe
-- porque o schema anterior não guardava preço no item — que é exatamente o
-- problema que esta fase resolve daqui para frente. Vendas feitas a partir
-- de agora gravam o preço praticado no momento da venda.

-- ---------------------------------------------------------------------------
-- Preço congelado nos itens já vendidos
-- ---------------------------------------------------------------------------
UPDATE "product_order" po
SET "unit_price"  = p."price",
    "total_price" = p."price" * po."quantity"
FROM "products" p
WHERE p."id" = po."product_id"
  AND po."unit_price" IS NULL;

-- ---------------------------------------------------------------------------
-- Total do pedido, a partir dos itens recém-preenchidos
-- ---------------------------------------------------------------------------
UPDATE "orders" o
SET "total_amount" = COALESCE(
  (SELECT SUM(po."total_price") FROM "product_order" po WHERE po."order_id" = o."id"),
  0
);

-- ---------------------------------------------------------------------------
-- Data de pagamento dos pedidos já pagos
--
-- SEGUNDA PREMISSA: paid_at = created_at. `created_at` é o único carimbo de
-- tempo que o schema anterior tinha, e pedido criado e pago no mesmo dia é o
-- caso dominante em restaurante. Pedidos não pagos ficam com paid_at nulo,
-- inclusive os 3 que foram arrastados para o histórico sem pagamento pelo
-- `updateOrderRestarted` antigo.
-- ---------------------------------------------------------------------------
UPDATE "orders"
SET "paid_at" = "created_at"
WHERE "paid" = true
  AND "paid_at" IS NULL;

-- ---------------------------------------------------------------------------
-- stock_applied_at fica NULO em todos os pedidos, inclusive nos já pagos.
--
-- Não é esquecimento: não existia estoque quando essas vendas aconteceram, e
-- dar baixa retroativa nelas na Fase 5 produziria saldo negativo falso. A baixa
-- da Fase 5 dispara na TRANSIÇÃO para pago, nunca varrendo pedidos já pagos.
-- ---------------------------------------------------------------------------
