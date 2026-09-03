import { Module } from '@nestjs/common';

import { StockModule } from '../stock/stock.module';
import { RecipesModule } from '../recipes/recipes.module';
import { PurchasesModule } from '../purchases/purchases.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { PricingModule } from '../pricing/pricing.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './services/analytics.service';
import { SalesAggregationService } from './services/sales-aggregation.service';
import { StockAggregationService } from './services/stock-aggregation.service';

/**
 * Camada de leitura sobre todas as anteriores. Não define regra de negócio
 * própria: pega o custo da ficha, o rateio das despesas e os percentuais da
 * formação de preço de onde eles já moram, para o painel nunca discordar do
 * relatório que o alimentou.
 */
@Module({
  imports: [
    StockModule,
    RecipesModule,
    PurchasesModule,
    ExpensesModule,
    PricingModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    SalesAggregationService,
    StockAggregationService,
  ],
  exports: [AnalyticsService, SalesAggregationService, StockAggregationService],
})
export class AnalyticsModule {}
