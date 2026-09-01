import { Transform } from 'class-transformer';
import { IsBooleanString, IsIn, IsOptional, IsUUID } from 'class-validator';

export class ListRecipesDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** PRODUCT traz fichas de prato; SUB traz sub-receitas. */
  @IsOptional()
  @IsIn(['PRODUCT', 'SUB'])
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  type?: 'PRODUCT' | 'SUB';

  @IsOptional()
  @IsBooleanString()
  active?: string;
}
