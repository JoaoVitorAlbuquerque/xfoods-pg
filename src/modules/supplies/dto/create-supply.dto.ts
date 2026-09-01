import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  IsNonNegativeDecimal,
  IsPositiveDecimal,
} from 'src/shared/validators/is-decimal-like';

export class CreateSupplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID()
  supplyCategoryId?: string;

  /**
   * Sigla da unidade em que o saldo deste insumo é guardado — "G" para queijo,
   * "UN" para espeto de madeira. Não aceita unidade de embalagem: sem fator de
   * conversão, não haveria como transformar uma compra em saldo.
   */
  @IsString()
  @IsNotEmpty()
  baseUnit: string;

  @IsOptional()
  @IsNonNegativeDecimal()
  minStock?: string | number;

  @IsOptional()
  @IsPositiveDecimal()
  maxStock?: string | number;

  /**
   * Saldo de abertura. Não é gravado direto no saldo: vira uma movimentação de
   * ADJUSTMENT com motivo "saldo inicial", porque saldo sem movimentação
   * correspondente é exatamente o que este módulo não permite.
   */
  @IsOptional()
  @IsNonNegativeDecimal()
  initialStock?: string | number;

  /** Unidade do saldo de abertura. Ausente = unidade base. */
  @IsOptional()
  @IsString()
  initialStockUnit?: string;

  /** Custo por unidade informada em `initialStockUnit`. */
  @IsOptional()
  @IsNonNegativeDecimal()
  initialUnitCost?: string | number;
}
