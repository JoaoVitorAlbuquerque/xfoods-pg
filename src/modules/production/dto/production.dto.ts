import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ProductionStatus } from '@prisma/client';

import { IsPositiveDecimal } from 'src/shared/validators/is-decimal-like';

export class ProductionItemDto {
  @IsUUID()
  supplyId: string;

  @IsPositiveDecimal()
  quantity: string | number;

  /** Sigla da unidade. Ausente, vale a unidade base do insumo. */
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateProductionOrderDto {
  /** Sub-receita produzida. Precisa ter insumo de saída e rendimento. */
  @IsUUID()
  recipeId: string;

  /**
   * Quantas vezes a receita foi executada. Dobrar o lote dobra ingredientes e
   * rendimento previsto.
   */
  @IsOptional()
  @IsPositiveDecimal()
  batches?: string | number;

  /**
   * Ingredientes de fato usados. Ausente, o sistema deriva da ficha × lotes.
   * Informar serve para o caso real de ter usado 8,2 kg de tomate onde a ficha
   * pedia 8 — a produção registra o que aconteceu, não o que estava planejado.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductionItemDto)
  items?: ProductionItemDto[];

  /** Data de competência da produção. Ausente, agora. */
  @IsOptional()
  @IsDateString()
  producedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ConfirmProductionOrderDto {
  /**
   * Rendimento REAL, na unidade de rendimento da ficha. Ausente, assume o
   * previsto.
   *
   * É este número que entra no estoque, e é ele que divide o custo: um lote que
   * rendeu 9 kg em vez de 10 carrega o mesmo custo de ingredientes em menos
   * produto, e o custo por kg sobe. É assim que a perda de produção chega ao
   * preço do prato em vez de sumir.
   */
  @IsOptional()
  @IsPositiveDecimal()
  actualQuantity?: string | number;

  /** Unidade do rendimento informado. Ausente, a unidade de rendimento da ficha. */
  @IsOptional()
  @IsString()
  actualQuantityUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ListProductionOrdersDto {
  @IsOptional()
  @IsEnum(ProductionStatus)
  status?: ProductionStatus;

  @IsOptional()
  @IsUUID()
  recipeId?: string;

  @IsOptional()
  @IsUUID()
  outputSupplyId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
