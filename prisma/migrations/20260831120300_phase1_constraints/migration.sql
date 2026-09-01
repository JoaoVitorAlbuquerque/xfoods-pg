-- Fase 1 · Fundação — 4/4: restrições
--
-- Só agora, com todas as linhas preenchidas pelo backfill, o preço congelado
-- passa a ser obrigatório. A partir daqui é impossível gravar um item de venda
-- sem registrar por quanto ele foi vendido.

ALTER TABLE "product_order" ALTER COLUMN "unit_price"  SET NOT NULL;
ALTER TABLE "product_order" ALTER COLUMN "total_price" SET NOT NULL;
