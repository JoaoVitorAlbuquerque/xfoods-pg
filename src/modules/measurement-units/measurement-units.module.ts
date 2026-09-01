import { Module } from '@nestjs/common';

import { MeasurementUnitsController } from './measurement-units.controller';
import { MeasurementUnitsService } from './services/measurement-units.service';
import { UnitConversionService } from './services/unit-conversion.service';
import { ValidateMeasurementUnitOwnershipService } from './services/validate-measurement-unit-ownership.service';

@Module({
  controllers: [MeasurementUnitsController],
  providers: [
    MeasurementUnitsService,
    UnitConversionService,
    ValidateMeasurementUnitOwnershipService,
  ],
  // Exportados para os módulos de insumos, compras e fichas técnicas, que vão
  // converter para a unidade base antes de gravar qualquer quantidade.
  exports: [MeasurementUnitsService, UnitConversionService],
})
export class MeasurementUnitsModule {}
