import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockModule } from '../stock/stock.module';
import { PurchasesController } from './purchases.controller';
import { SuppliersController } from './suppliers.controller';
import { SupplyCostsController } from './supply-costs.controller';
import { PurchasesService } from './services/purchases.service';
import { SuppliersService } from './services/suppliers.service';
import { SupplyCostsService } from './services/supply-costs.service';

@Module({
  imports: [MeasurementUnitsModule, StockModule],
  controllers: [PurchasesController, SuppliersController, SupplyCostsController],
  providers: [PurchasesService, SuppliersService, SupplyCostsService],
  exports: [SupplyCostsService],
})
export class PurchasesModule {}
