import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

import {
  IsNonNegativeDecimal,
  IsPositiveDecimal,
} from 'src/shared/validators/is-decimal-like';

export class UpdatePricingSettingsDto {
  /** Margem sobre o PREÇO de venda, não sobre o custo. */
  @IsOptional()
  @IsNonNegativeDecimal()
  desiredMarginPercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  taxPercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  cardFeePercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  deliveryFeePercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  otherFeesPercent?: string | number;
}

/**
 * Sobrescreve os percentuais gravados só para esta consulta.
 *
 * É o que permite precificar por canal sem duplicar configuração: balcão sem
 * taxa de cartão é `?cardFeePercent=0&deliveryFeePercent=0`.
 */
export class PricingQueryDto {
  @IsOptional()
  @IsNonNegativeDecimal()
  marginPercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  taxPercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  cardFeePercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  deliveryFeePercent?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  otherFeesPercent?: string | number;

  /**
   * Competência do custo indireto. Ausente, vale o mês corrente — o mesmo
   * padrão do rateio.
   */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class SimulatePricingDto extends PricingQueryDto {
  /** Simula um prato do cardápio, com o custo completo real dele. */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Ou um custo avulso, para testar um prato que ainda não existe. */
  @IsOptional()
  @IsPositiveDecimal()
  cost?: string | number;

  /**
   * Margens a simular. Aceita `30,35,40,45` ou o parâmetro repetido.
   * Ausente, usa uma faixa em torno da margem configurada.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list.map((item) => String(item).trim()).filter(Boolean);
  })
  @IsNonNegativeDecimal({ each: true })
  margins?: (string | number)[];
}
