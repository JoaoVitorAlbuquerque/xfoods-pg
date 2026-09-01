import { Transform } from 'class-transformer';
import { IsBooleanString, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

import { StockStatus } from 'src/modules/stock/services/stock-level.service';

export class ListSuppliesDto {
  /** Busca por parte do nome, sem diferenciar maiúsculas. */
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  supplyCategoryId?: string;

  @IsOptional()
  @IsBooleanString()
  active?: string;

  @IsOptional()
  @IsEnum(StockStatus)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  stockStatus?: StockStatus;
}
