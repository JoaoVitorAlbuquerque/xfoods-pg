import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ExpenseRecurrence, ExpenseType } from '@prisma/client';

import { IsPositiveDecimal } from 'src/shared/validators/is-decimal-like';

/**
 * Tudo opcional: só o que vier é alterado.
 *
 * Mudar `amount` reescreve o custo de TODAS as competências passadas desta
 * despesa. Para um reajuste, encerre esta com `endDate` e crie outra — é o
 * mesmo motivo de o preço do produto ficar congelado no item de venda.
 * O serviço avisa quando o valor muda numa despesa que já tem histórico.
 */
export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsUUID()
  expenseCategoryId?: string | null;

  @IsOptional()
  @IsEnum(ExpenseType)
  type?: ExpenseType;

  @IsOptional()
  @IsEnum(ExpenseRecurrence)
  recurrence?: ExpenseRecurrence;

  @IsOptional()
  @IsPositiveDecimal()
  amount?: string | number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @IsBoolean()
  includeInAllocation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
