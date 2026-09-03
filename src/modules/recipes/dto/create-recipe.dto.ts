import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { SizeType } from '@prisma/client';

import {
  IsNonNegativeDecimal,
  IsPositiveDecimal,
} from 'src/shared/validators/is-decimal-like';

/**
 * Multiplicador de consumo por tamanho vendido.
 *
 * A ficha descreve uma unidade do prato e o tamanho a escala. Uma pizza broto
 * não usa a mesma massa que uma gigante — sem isto a baixa erraria em todo
 * produto vendido em mais de um tamanho.
 *
 * Tamanhos disponíveis: TINY (broto), SMALL (pequena), MEAN (média),
 * LARGE (grande), EXTRA_LARGE (gigante) e METER (metro).
 * Tamanho sem fator cadastrado vale 1.
 */
export class RecipeSizeFactorDto {
  @IsEnum(SizeType)
  size: SizeType;

  @IsPositiveDecimal()
  factor: string | number;
}

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

  /**
   * Insumo onde o subproduto desta sub-receita é estocado.
   *
   * Informar transforma a sub-receita em item PRODUZIDO: ela passa a ter saldo
   * próprio, e as fichas que a usam consomem esse saldo em vez de desdobrar
   * até tomate e cebola. Quem repõe o saldo é a ordem de produção.
   *
   * Só vale para sub-receita, e a unidade base do insumo precisa ser da mesma
   * grandeza do rendimento.
   */
  @IsOptional()
  @IsUUID()
  outputSupplyId?: string;

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

  /** Informado substitui a tabela inteira de fatores. Ausente mantém a atual. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RecipeSizeFactorDto)
  sizeFactors?: RecipeSizeFactorDto[];
}
