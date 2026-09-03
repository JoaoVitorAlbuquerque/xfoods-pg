import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';

import { ActiveUserId } from 'src/shared/decorators/ActiveUserId';
import { AnalyticsService } from './services/analytics.service';
import {
  AlertsQueryDto,
  AnalyticsQueryDto,
  ProductRankingDto,
} from './dto/analytics-query.dto';

/**
 * Painéis gerenciais. Só leitura — nenhuma rota aqui escreve.
 *
 * Todos aceitam o mesmo conjunto de filtros: período, categoria, produto e
 * insumo. Onde um filtro não faz sentido para um dos lados da conta, a resposta
 * diz o que ficou de fora em vez de aplicar em silêncio.
 */
@Controller('analytics')
// Pipe próprio porque o global do `main.ts` não converte tipos, e `limit` e
// `offset` chegariam como texto direto para o `take`/`skip` do Prisma.
@UsePipes(new ValidationPipe({ transform: true }))
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /** Faturamento, custos, lucro, margem, estoque e desperdício do período. */
  @Get('overview')
  getOverview(
    @ActiveUserId() userId: string,
    @Query() filters: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getOverview(userId, filters);
  }

  /** Ranking de produtos. `rankBy` aceita REVENUE, PROFIT, MARGIN_HIGH, MARGIN_LOW, COST, QUANTITY. */
  @Get('products')
  getProductRanking(
    @ActiveUserId() userId: string,
    @Query() filters: ProductRankingDto,
  ) {
    return this.analyticsService.getProductRanking(userId, filters);
  }

  @Get('products/:productId')
  getProductDetail(
    @ActiveUserId() userId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Query() filters: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getProductDetail(userId, productId, filters);
  }

  @Get('alerts')
  getAlerts(
    @ActiveUserId() userId: string,
    @Query() filters: AlertsQueryDto,
  ) {
    return this.analyticsService.getAlerts(userId, filters);
  }

  @Get('stock')
  getStockDashboard(
    @ActiveUserId() userId: string,
    @Query() filters: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getStockDashboard(userId, filters);
  }

  @Get('costs')
  getCostDashboard(
    @ActiveUserId() userId: string,
    @Query() filters: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getCostDashboard(userId, filters);
  }
}
