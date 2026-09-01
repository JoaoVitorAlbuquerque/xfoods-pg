-- Fase de unidades de medida
--
-- Base canônica por grandeza: G (massa), ML (volume), UN (contagem).
-- `factor_to_base` = quantas unidades base cabem em 1 desta unidade.

CREATE TYPE "unit_kind" AS ENUM ('WEIGHT', 'VOLUME', 'COUNT');

CREATE TABLE "measurement_units" (
    "id"             UUID NOT NULL,
    "user_id"        UUID,
    "code"           TEXT NOT NULL,
    "name"           TEXT NOT NULL,
    "kind"           "unit_kind" NOT NULL,
    "factor_to_base" DECIMAL(20,8),
    "is_base"        BOOLEAN NOT NULL DEFAULT false,
    "is_packaging"   BOOLEAN NOT NULL DEFAULT false,
    "is_system"      BOOLEAN NOT NULL DEFAULT false,
    "active"         BOOLEAN NOT NULL DEFAULT true,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "measurement_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "measurement_units_user_id_code_key" ON "measurement_units"("user_id", "code");
CREATE INDEX "measurement_units_user_id_idx" ON "measurement_units"("user_id");
CREATE INDEX "measurement_units_kind_idx" ON "measurement_units"("kind");

ALTER TABLE "measurement_units"
  ADD CONSTRAINT "measurement_units_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Catálogo de sistema (user_id nulo, compartilhado por todos os tenants).
--
-- Só a migração cria unidade de sistema: a API recusa `isSystem` na criação.
-- É isso que garante que os fatores físicos não sejam editáveis por ninguém.
--
-- CX, PCT e FARDO entram sem fator de propósito. Elas existem para o usuário
-- comprar "3 caixas", mas quantos gramas isso vale depende do insumo — esse
-- fator é definido por insumo no módulo de compras.
-- ---------------------------------------------------------------------------
INSERT INTO "measurement_units"
  ("id", "user_id", "code", "name", "kind", "factor_to_base", "is_base", "is_packaging", "is_system")
VALUES
  (gen_random_uuid(), NULL, 'G',     'Grama',       'WEIGHT', 1,    true,  false, true),
  (gen_random_uuid(), NULL, 'KG',    'Quilograma',  'WEIGHT', 1000, false, false, true),
  (gen_random_uuid(), NULL, 'MG',    'Miligrama',   'WEIGHT', 0.001, false, false, true),
  (gen_random_uuid(), NULL, 'ML',    'Mililitro',   'VOLUME', 1,    true,  false, true),
  (gen_random_uuid(), NULL, 'L',     'Litro',       'VOLUME', 1000, false, false, true),
  (gen_random_uuid(), NULL, 'UN',    'Unidade',     'COUNT',  1,    true,  false, true),
  (gen_random_uuid(), NULL, 'DZ',    'Dúzia',       'COUNT',  12,   false, false, true),
  (gen_random_uuid(), NULL, 'CX',    'Caixa',       'COUNT',  NULL, false, true,  true),
  (gen_random_uuid(), NULL, 'PCT',   'Pacote',      'COUNT',  NULL, false, true,  true),
  (gen_random_uuid(), NULL, 'FARDO', 'Fardo',       'COUNT',  NULL, false, true,  true);
