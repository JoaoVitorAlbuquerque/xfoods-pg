import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockModule } from '../stock/stock.module';
import { RecipesModule } from '../recipes/recipes.module';
import { ProductionController } from './production.controller';
import { ProductionService } from './services/production.service';

/**
 * Produção de subprodutos. Depende de RecipesModule porque os ingredientes do
 * lote saem do desdobramento da própria ficha, e de StockModule porque consumo
 * e entrada precisam passar pelo mesmo motor de razão que todo o resto.
 */
@Module({
  imports: [MeasurementUnitsModule, StockModule, RecipesModule],
  controllers: [ProductionController],
  providers: [ProductionService],
  exports: [ProductionService],
})
export class ProductionModule {}
