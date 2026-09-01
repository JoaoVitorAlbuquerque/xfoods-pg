-- Fase 1 · Fundação — alinhamento final
--
-- O `DEFAULT gen_random_uuid()` foi usado na parte 2/4 apenas para preencher o
-- id das 46 linhas que já existiam. O schema declara `@default(uuid())`, que o
-- Prisma resolve na aplicação — manter o default no banco deixaria o schema em
-- drift e faria o próximo `migrate dev` gerar uma migração corretiva sozinho.

ALTER TABLE "product_order" ALTER COLUMN "id" DROP DEFAULT;
