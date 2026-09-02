import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { AllocationMethod, AllocationPeriod } from '@prisma/client';

import { IsNonNegativeDecimal } from 'src/shared/validators/is-decimal-like';

export class UpdateCostAllocationSettingsDto {
  /**
   * Só PER_SOLD_UNIT está implementado. BY_REVENUE e MANUAL são aceitos aqui e
   * recusados no cálculo, com mensagem — melhor gravar a intenção e falhar
   * explicitamente do que devolver um número plausível e errado.
   */
  @IsOptional()
  @IsEnum(AllocationMethod)
  method?: AllocationMethod;

  /** A que período a estimativa se refere. */
  @IsOptional()
  @IsEnum(AllocationPeriod)
  referencePeriod?: AllocationPeriod;

  /** Unidades que se espera vender no período de referência. */
  @IsOptional()
  @IsNonNegativeDecimal()
  estimatedSalesUnits?: string | number;

  /** Receita esperada no período. Sem uso enquanto BY_REVENUE não existir. */
  @IsOptional()
  @IsNonNegativeDecimal()
  estimatedRevenue?: string | number;

  @IsOptional()
  @IsBoolean()
  includeFixed?: boolean;

  @IsOptional()
  @IsBoolean()
  includeVariable?: boolean;
}
