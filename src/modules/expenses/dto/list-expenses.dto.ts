import {
  IsBooleanString,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { CostNature, ExpenseRecurrence, ExpenseType } from '@prisma/client';

export class ListExpensesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  expenseCategoryId?: string;

  @IsOptional()
  @IsEnum(ExpenseType)
  type?: ExpenseType;

  @IsOptional()
  @IsEnum(ExpenseRecurrence)
  recurrence?: ExpenseRecurrence;

  @IsOptional()
  @IsEnum(CostNature)
  nature?: CostNature;

  @IsOptional()
  @IsBooleanString()
  active?: string;

  /**
   * Filtro por COMPETÊNCIA, não por cadastro: traz as despesas cuja vigência
   * cruza a janela. Uma despesa iniciada em janeiro e sem fim aparece num
   * filtro de março, mesmo tendo sido cadastrada em janeiro.
   */
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

/** Janela de competência dos relatórios. Ausente, vale o mês corrente. */
export class ExpensePeriodDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
