import { Body, Controller, Get, Put, Query } from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { CostAllocationService } from './services/cost-allocation.service';
import { ExpensePeriodDto } from './dto/list-expenses.dto';
import { UpdateCostAllocationSettingsDto } from './dto/cost-allocation-settings.dto';

/**
 * Rateio do custo indireto. Só leitura e configuração — nenhum endpoint aqui
 * altera preço de venda.
 */
@Controller('cost-allocation')
export class CostAllocationController {
  constructor(private readonly costAllocationService: CostAllocationService) {}

  @Get('settings')
  getSettings(@ActiveUserId() userId: string) {
    return this.costAllocationService.getSettings(userId);
  }

  @Put('settings')
  updateSettings(
    @ActiveUserId() userId: string,
    @Body() dto: UpdateCostAllocationSettingsDto,
  ) {
    return this.costAllocationService.updateSettings(userId, dto);
  }

  /** Custo indireto do período e quanto ele representa por unidade vendida. */
  @Get()
  getAllocation(
    @ActiveUserId() userId: string,
    @Query() filters: ExpensePeriodDto,
  ) {
    return this.costAllocationService.getAllocation(userId, filters);
  }

  /** Custo direto + custo indireto rateado, por produto. */
  @Get('full-cost')
  getFullCost(
    @ActiveUserId() userId: string,
    @Query() filters: ExpensePeriodDto,
  ) {
    return this.costAllocationService.getFullCost(userId, filters);
  }
}
