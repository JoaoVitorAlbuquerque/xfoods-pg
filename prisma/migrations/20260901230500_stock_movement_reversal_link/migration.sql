-- Estorno rastreável no livro-razão.
--
-- Escrita à mão porque `migrate dev` pede confirmação interativa ao criar um
-- índice único sobre coluna existente. A coluna nasce nula em todas as linhas,
-- então não há duplicata possível.
--
-- O índice único é o que impede um mesmo consumo de ser devolvido ao estoque
-- duas vezes: sem ele, dois cancelamentos concorrentes da mesma venda gerariam
-- dois RETURN para o mesmo SALE.

ALTER TABLE "stock_movements" ADD COLUMN "reversal_of_id" UUID;

CREATE UNIQUE INDEX "stock_movements_reversal_of_id_key"
  ON "stock_movements"("reversal_of_id");

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_reversal_of_id_fkey"
  FOREIGN KEY ("reversal_of_id") REFERENCES "stock_movements"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
