import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { SupplyCostsService } from './services/supply-costs.service';

@Controller('supply-costs')
export class SupplyCostsController {
  constructor(private readonly supplyCostsService: SupplyCostsService) {}

  /** Insumo · último custo · custo anterior · data · variação %. */
  @Get('report')
  getReport(@ActiveUserId() userId: string) {
    return this.supplyCostsService.getVariationReport(userId);
  }

  @Get(':supplyId/history')
  getHistory(
    @ActiveUserId() userId: string,
    @Param('supplyId', ParseUUIDPipe) supplyId: string,
  ) {
    return this.supplyCostsService.findHistoryBySupply(userId, supplyId);
  }
}
