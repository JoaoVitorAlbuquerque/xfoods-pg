import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockController } from './stock.controller';
import { StockCountsController } from './stock-counts.controller';
import { StockService } from './services/stock.service';
import { StockLevelService } from './services/stock-level.service';
import { StockMovementsService } from './services/stock-movements.service';
import { StockSettingsService } from './services/stock-settings.service';
import { StockCountsService } from './services/stock-counts.service';
import { SupplyCostingService } from './services/supply-costing.service';

@Module({
  imports: [MeasurementUnitsModule],
  controllers: [StockController, StockCountsController],
  providers: [
    StockService,
    StockLevelService,
    StockMovementsService,
    StockSettingsService,
    StockCountsService,
    SupplyCostingService,
  ],
  // `StockMovementsService` é exportado porque a baixa automática da venda
  // (Fase 5) vai chamá-lo passando a transação do pagamento, e o cadastro de
  // insumo o usa para transformar saldo de abertura em movimentação.
  exports: [
    StockMovementsService,
    StockLevelService,
    StockSettingsService,
    SupplyCostingService,
    // Exportado para o painel gerencial, que mostra a posição de estoque junto
    // dos demais indicadores em vez de reimplementar a classificação de nível.
    StockService,
  ],
})
export class StockModule {}
