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

import {
  IsPositiveDecimal,
  IsNonNegativeDecimal,
} from 'src/shared/validators/is-decimal-like';

export class CreatePurchaseItemDto {
  @IsUUID()
  supplyId: string;

  @IsPositiveDecimal()
  quantity: string | number;

  /** Unidade da compra — "KG" mesmo que o insumo seja estocado em gramas. */
  @IsString()
  unit: string;

  /**
   * Informe `unitPrice` OU `totalPrice`, nunca os dois. A nota às vezes traz o
   * preço por quilo, às vezes só o total da linha; o que faltar é calculado.
   * Aceitar ambos abriria espaço para uma linha em que um contradiz o outro.
   */
  @IsOptional()
  @IsNonNegativeDecimal()
  unitPrice?: string | number;

  @IsOptional()
  @IsNonNegativeDecimal()
  totalPrice?: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  batch?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class CreatePurchaseDto {
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documentNumber?: string;

  @IsOptional()
  @IsDateString()
  issuedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // `totalAmount` não é aceito: ele é a soma dos itens. Receber um total
  // informado permitiria gravar uma nota cujo cabeçalho não bate com as
  // linhas, e nada no sistema saberia qual dos dois está certo.

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseItemDto)
  items: CreatePurchaseItemDto[];
}
