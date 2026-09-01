import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateMeasurementUnitDto } from './create-measurement-unit.dto';

export class UpdateMeasurementUnitDto extends PartialType(
  CreateMeasurementUnitDto,
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
