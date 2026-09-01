import { Module } from '@nestjs/common';

import { MeasurementUnitsModule } from '../measurement-units/measurement-units.module';
import { StockModule } from '../stock/stock.module';
import { SuppliesController } from './supplies.controller';
import { SupplyCategoriesController } from './supply-categories.controller';
import { SuppliesService } from './services/supplies.service';
import { SupplyCategoriesService } from './services/supply-categories.service';
import { ValidateSupplyOwnershipService } from './services/validate-supply-ownership.service';

@Module({
  imports: [MeasurementUnitsModule, StockModule],
  controllers: [SuppliesController, SupplyCategoriesController],
  providers: [
    SuppliesService,
    SupplyCategoriesService,
    ValidateSupplyOwnershipService,
  ],
  exports: [ValidateSupplyOwnershipService, SuppliesService],
})
export class SuppliesModule {}
