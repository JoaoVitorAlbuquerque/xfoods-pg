import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CostNature } from '@prisma/client';

export class CreateExpenseCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /**
   * INDIRECT é o padrão e é o que entra no rateio. DIRECT existe para custos
   * que pertencem ao prato sem passar pela ficha técnica — marcar assim tira a
   * categoria do rateio, para o custo não ser contado duas vezes.
   */
  @IsOptional()
  @IsEnum(CostNature)
  nature?: CostNature;
}

export class UpdateExpenseCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(CostNature)
  nature?: CostNature;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
