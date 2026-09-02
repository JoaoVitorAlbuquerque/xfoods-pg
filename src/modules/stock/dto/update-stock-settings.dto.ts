import { IsBoolean, IsOptional } from 'class-validator';

import { IsNonNegativeDecimal } from 'src/shared/validators/is-decimal-like';

export class UpdateStockSettingsDto {
  /**
   * Falso bloqueia saída maior que o saldo nas operações manuais.
   * Verdadeiro permite e o insumo passa a aparecer com situação NEGATIVE.
   */
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

  /**
   * Falso impede concluir a venda de um prato sem ficha ativa.
   * Verdadeiro deixa vender, devolve alerta e não gera consumo.
   */
  @IsOptional()
  @IsBoolean()
  allowSaleWithoutRecipe?: boolean;

  /**
   * Desvio aceitável entre o consumo previsto pelas fichas e o consumo real,
   * em porcento. Zero passa a acusar qualquer diferença — inclusive as de
   * arredondamento —, então o padrão é 5.
   */
  @IsOptional()
  @IsNonNegativeDecimal()
  stockConsumptionTolerancePercentage?: string | number;
}
