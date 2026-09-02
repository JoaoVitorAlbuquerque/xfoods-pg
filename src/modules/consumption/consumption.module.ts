import { Module } from '@nestjs/common';

import { RecipesModule } from '../recipes/recipes.module';
import { StockModule } from '../stock/stock.module';
import { ConsumptionController } from './consumption.controller';
import { ConsumptionAnalysisService } from './services/consumption-analysis.service';
import { ConsumptionReportService } from './services/consumption-report.service';

/**
 * Módulo só de leitura: confronta vendas, fichas e razão de estoque sem
 * escrever nada. É o que permite ligá-lo sem risco para a operação — um
 * relatório errado atrapalha uma decisão, mas não corrompe o estoque.
 */
@Module({
  imports: [RecipesModule, StockModule],
  controllers: [ConsumptionController],
  providers: [ConsumptionAnalysisService, ConsumptionReportService],
  exports: [ConsumptionAnalysisService, ConsumptionReportService],
})
export class ConsumptionModule {}
