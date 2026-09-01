import { StockMovementType } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import {
  IsNonNegativeDecimal,
  IsPositiveDecimal,
} from 'src/shared/validators/is-decimal-like';

/**
 * SALE nunca é aceito por estas rotas. A baixa de venda é gerada pela própria
 * venda, na Fase 5, dentro da transação do pagamento — permitir lançá-la à mão
 * abriria caminho para consumo em dobro e para um estoque que não bate com
 * nenhum pedido.
 */
export const MANUAL_ENTRY_TYPES = [
  StockMovementType.PURCHASE,
  StockMovementType.RETURN,
  StockMovementType.PRODUCTION,
  StockMovementType.TRANSFER,
] as const;

export const MANUAL_EXIT_TYPES = [
  StockMovementType.PRODUCTION,
  StockMovementType.RETURN,
  StockMovementType.TRANSFER,
] as const;

class BaseStockOperationDto {
  @IsUUID()
  supplyId: string;

  /** Magnitude positiva. O sentido vem da rota, não do sinal. */
  @IsPositiveDecimal()
  quantity: string | number;

  /** Sigla da unidade informada. Ausente = unidade base do insumo. */
  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

// `reason` fica fora da base de propósito. Declará-lo opcional aqui e tentar
// torná-lo obrigatório na subclasse não funciona: o class-validator soma os
// metadados da hierarquia inteira, e o `@IsOptional()` do pai continuaria
// dispensando o campo — foi assim que uma perda sem motivo passou no teste.
export class CreateStockEntryDto extends BaseStockOperationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsOptional()
  @IsIn(MANUAL_ENTRY_TYPES as unknown as string[])
  type?: (typeof MANUAL_ENTRY_TYPES)[number];

  /** Custo por unidade informada em `unit`. Recalcula o custo médio. */
  @IsOptional()
  @IsNonNegativeDecimal()
  unitCost?: string | number;
}

export class CreateStockExitDto extends BaseStockOperationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  @IsIn(MANUAL_EXIT_TYPES as unknown as string[])
  type: (typeof MANUAL_EXIT_TYPES)[number];
}

export class CreateStockLossDto extends BaseStockOperationDto {
  /** Obrigatório: perda sem motivo registrado não é auditável. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;
}

export class CreateStockAdjustmentDto {
  @IsUUID()
  supplyId: string;

  /** Saldo correto — absoluto, não diferença. A diferença é calculada. */
  @IsNonNegativeDecimal()
  targetQuantity: string | number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  reason: string;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
