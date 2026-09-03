import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { IsNonNegativeDecimal } from 'src/shared/validators/is-decimal-like';

export enum ProductRanking {
  REVENUE = 'REVENUE',
  PROFIT = 'PROFIT',
  MARGIN_HIGH = 'MARGIN_HIGH',
  MARGIN_LOW = 'MARGIN_LOW',
  COST = 'COST',
  QUANTITY = 'QUANTITY',
}

export class AnalyticsQueryDto {
  /** Competência. Ausente, vale o mês corrente — o mesmo padrão do rateio. */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Categoria do cardápio. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  supplyId?: string;

  @IsOptional()
  @IsUUID()
  supplyCategoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ProductRankingDto extends AnalyticsQueryDto {
  @IsOptional()
  @IsEnum(ProductRanking)
  rankBy?: ProductRanking;
}

export class AlertsQueryDto extends AnalyticsQueryDto {
  /**
   * Acima deste percentual do preço, o custo completo do prato é considerado
   * elevado. 35% é uma referência comum de food cost no setor, não uma regra —
   * por isso entra como parâmetro e não como constante.
   */
  @IsOptional()
  @IsNonNegativeDecimal()
  highCostThresholdPercent?: string | number;

  /** Alta de custo de insumo a partir da qual vale avisar. */
  @IsOptional()
  @IsNonNegativeDecimal()
  costIncreaseThresholdPercent?: string | number;

  /** Perda em reais a partir da qual o insumo entra na lista. */
  @IsOptional()
  @IsNonNegativeDecimal()
  wasteThresholdCost?: string | number;
}
