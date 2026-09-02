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

export class CreateExpenseDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  description: string;

  @IsOptional()
  @IsUUID()
  expenseCategoryId?: string;

  /** FIXED não varia com o volume; VARIABLE acompanha o movimento. */
  @IsOptional()
  @IsEnum(ExpenseType)
  type?: ExpenseType;

  @IsOptional()
  @IsEnum(ExpenseRecurrence)
  recurrence?: ExpenseRecurrence;

  /** Valor de UMA ocorrência, não o total do ano. */
  @IsPositiveDecimal()
  amount: string | number;

  /**
   * Início da competência — a partir de quando a despesa pesa no custo. Não é
   * a data de cadastro: uma despesa lançada hoje pode valer desde janeiro.
   * Tratada como data pura; a hora é descartada.
   */
  @IsDateString()
  startDate: string;

  /** Fim da competência. Ausente, a despesa segue valendo. */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  /**
   * Tira esta despesa do rateio sem desativá-la — obra, equipamento, um gasto
   * pontual que não deve pesar no custo de cada prato.
   */
  @IsOptional()
  @IsBoolean()
  includeInAllocation?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
