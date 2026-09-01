import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { IsNonNegativeDecimal } from 'src/shared/validators/is-decimal-like';

export class StockCountItemDto {
  @IsUUID()
  supplyId: string;

  /** Quanto foi encontrado na contagem física. */
  @IsNonNegativeDecimal()
  countedQuantity: string | number;

  /** Unidade em que foi contado. Ausente = unidade base do insumo. */
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateStockCountDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;

  @IsOptional()
  @IsDateString()
  countedAt?: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => StockCountItemDto)
  items: StockCountItemDto[];
}
