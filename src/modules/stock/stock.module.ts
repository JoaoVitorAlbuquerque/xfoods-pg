import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockController } from './stock.controller';
import { StockCountsController } from './stock-counts.controller';
import { StockService } from './services/stock.service';
import { StockLevelService } from './services/stock-level.service';
import { StockMovementsService } from './services/stock-movements.service';
import { StockSettingsService } from './services/stock-settings.service';
import { StockCountsService } from './services/stock-counts.service';

@Module({
  imports: [MeasurementUnitsModule],
  controllers: [StockController, StockCountsController],
  providers: [
    StockService,
    StockLevelService,
    StockMovementsService,
    StockSettingsService,
    StockCountsService,
  ],
  // `StockMovementsService` é exportado porque a baixa automática da venda
  // (Fase 5) vai chamá-lo passando a transação do pagamento, e o cadastro de
  // insumo o usa para transformar saldo de abertura em movimentação.
  exports: [StockMovementsService, StockLevelService, StockSettingsService],
})
export class StockModule {}
