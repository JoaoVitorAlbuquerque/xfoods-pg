import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { StockMovementType } from '@prisma/client';

export enum PeriodGrouping {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export class ConsumptionReportDto {
  /** Início do período. Ausente, vale trinta dias atrás. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Fim do período. Ausente, vale agora. */
  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Categoria do cardápio, não do insumo. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  supplyId?: string;

  @IsOptional()
  @IsUUID()
  supplyCategoryId?: string;

  /**
   * Quais movimentações contam como consumo real. Aceita `SALE,LOSS` ou o
   * parâmetro repetido.
   *
   * Restringir aqui muda o que "real" significa: pedir só LOSS compara as
   * perdas registradas contra o consumo previsto inteiro, e a variação vai
   * parecer catastroficamente negativa. É útil para investigar uma causa
   * específica, não para medir desperdício.
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const list = Array.isArray(value) ? value : String(value).split(',');
    return list.map((item) => String(item).trim().toUpperCase()).filter(Boolean);
  })
  @IsEnum(StockMovementType, { each: true })
  movementTypes?: StockMovementType[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsEnum(PeriodGrouping)
  groupBy?: PeriodGrouping;
}
