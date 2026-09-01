import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateStockSettingsDto {
  /**
   * Falso bloqueia saída maior que o saldo nas operações manuais.
   * Verdadeiro permite e o insumo passa a aparecer com situação NEGATIVE.
   */
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;
}
