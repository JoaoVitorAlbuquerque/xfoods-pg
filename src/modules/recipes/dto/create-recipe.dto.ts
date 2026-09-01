import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  IsNonNegativeDecimal,
  IsPositiveDecimal,
} from 'src/shared/validators/is-decimal-like';

export class RecipeItemDto {
  /** Informe `supplyId` OU `subRecipeId`, nunca os dois. */
  @IsOptional()
  @IsUUID()
  supplyId?: string;

  @IsOptional()
  @IsUUID()
  subRecipeId?: string;

  /** Quantidade líquida — o que a receita de fato usa. Precisa ser > 0. */
  @IsPositiveDecimal()
  quantity: string | number;

  /**
   * Sigla da unidade em que a quantidade foi escrita. Precisa ser da mesma
   * grandeza da unidade base do insumo (ou do rendimento da sub-receita).
   */
  @IsString()
  unit: string;

  /**
   * Perda de preparo em porcento, de 0 a 100 (exclusivo). É quanto se perde do
   * que entra: 200 g líquidos com 10% de perda exigem 222,22 g brutos.
   */
  @IsOptional()
  @IsNonNegativeDecimal()
  wastePercent?: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}

export class CreateRecipeDto {
  /**
   * Prato a que esta ficha pertence. Ausente cria uma SUB-RECEITA (molho,
   * massa base), que existe para ser usada dentro de outras fichas.
   */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Obrigatório para sub-receita; opcional como apelido da versão do prato. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Quanto uma execução rende. Padrão 1 (uma porção do prato). */
  @IsOptional()
  @IsPositiveDecimal()
  yieldQuantity?: string | number;

  /** Sigla da unidade do rendimento. Obrigatória para sub-receita. */
  @IsOptional()
  @IsString()
  yieldUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Ativar esta versão ao criar. A primeira versão de um prato é ativada
   * automaticamente; as seguintes nascem inativas, para que criar uma versão
   * nova não troque em silêncio a ficha que está valendo nas vendas.
   */
  @IsOptional()
  @IsBoolean()
  activate?: boolean;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => RecipeItemDto)
  items: RecipeItemDto[];
}
