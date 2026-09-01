import { UnitKind } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateMeasurementUnitDto {
  /** Sigla exibida na operação: KG, L, BANDEJA. Normalizada para maiúsculas. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9_]+$/, {
    message: 'code must contain only letters, digits and underscore',
  })
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;

  @IsEnum(UnitKind)
  kind: UnitKind;

  /**
   * Quantas unidades base cabem em 1 desta unidade — 1 KG = 1000 G.
   * String de propósito: número em JSON já chega como float, e é exatamente
   * a imprecisão que este módulo existe para evitar.
   * Obrigatório, exceto quando `isPackaging` for true.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d*\.?\d+$/, {
    message: 'factorToBase must be a non-negative decimal sent as string',
  })
  factorToBase?: string;

  /**
   * Embalagem sem fator universal (caixa, pacote, fardo). O fator passa a ser
   * definido por insumo no módulo de compras.
   */
  @IsOptional()
  @IsBoolean()
  isPackaging?: boolean;
}
