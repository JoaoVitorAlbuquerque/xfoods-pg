import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockModule } from '../stock/stock.module';
import { RecipesController } from './recipes.controller';
import { RecipesService } from './services/recipes.service';
import { RecipeCostingService } from './services/recipe-costing.service';

@Module({
  imports: [MeasurementUnitsModule, StockModule],
  controllers: [RecipesController],
  providers: [RecipesService, RecipeCostingService],
  // Exportados para a baixa automática da venda, que vai ler a ficha ativa do
  // prato e congelar custo e versão no item vendido.
  exports: [RecipesService, RecipeCostingService],
})
export class RecipesModule {}
