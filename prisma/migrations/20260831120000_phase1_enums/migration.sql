-- Fase 1 · Fundação — 1/4: tipos enumerados
--
-- Isolado em migração própria de propósito: `ALTER TYPE ... ADD VALUE` tem
-- restrições de uso dentro do mesmo bloco transacional em que é declarado.

-- Papéis de acesso. Todo usuário existente vira OWNER na parte 2/4,
-- que é exatamente o que ele já podia fazer antes.
CREATE TYPE "user_role" AS ENUM ('OWNER', 'MANAGER', 'STAFF');

-- Cancelamento de pedido: até aqui a única forma de desfazer uma venda
-- era o DELETE em cascata, que apagava o histórico junto.
ALTER TYPE "order_type" ADD VALUE 'CANCELED';
