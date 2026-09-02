import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { ConsumptionReportService } from './services/consumption-report.service';
import { ConsumptionReportDto } from './dto/consumption-report.dto';

/**
 * Estimado x Real: o que as vendas e as fichas previam contra o que saiu do
 * estoque de fato.
 *
 * Todos os endpoints aceitam o mesmo conjunto de filtros e devolvem, junto do
 * resultado, as causas possíveis do desvio — o relatório aponta a diferença,
 * não o culpado.
 */
@Controller('consumption')
// Pipe próprio porque o global do `main.ts` não converte tipos: sem `transform`
// a query chegaria crua e `movementTypes` viraria a string 'SALE,LOSS' dentro
// do filtro do Prisma. Ligar no controller em vez de globalmente mantém as
// rotas antigas com exatamente o comportamento que já tinham.
@UsePipes(new ValidationPipe({ transform: true }))
export class ConsumptionController {
  constructor(private readonly reportService: ConsumptionReportService) {}

  /** Estimado x Real por insumo. */
  @Get('by-supply')
  bySupply(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.bySupply(userId, filters);
  }

  /** Estimado x Real por produto e insumo. */
  @Get('by-product')
  byProduct(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.byProduct(userId, filters);
  }

  /** Maiores desvios: o que mais se afastou da ficha, em porcentagem. */
  @Get('deviations')
  deviations(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.topDeviations(userId, filters);
  }

  /** Maiores perdas financeiras: o que mais custou, em dinheiro. */
  @Get('financial-losses')
  financialLosses(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.topFinancialLosses(userId, filters);
  }

  /** Desperdício ao longo do tempo, por dia, semana ou mês. */
  @Get('waste-by-period')
  wasteByPeriod(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.wasteByPeriod(userId, filters);
  }

  /** Painel: consumo estimado, real, desvio, custo e percentual de desperdício. */
  @Get('dashboard')
  dashboard(
    @ActiveUserId() userId: string,
    @Query() filters: ConsumptionReportDto,
  ) {
    return this.reportService.dashboard(userId, filters);
  }
}
