import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';

import { CreateSupplyCategoryDto } from './create-supply-category.dto';

export class UpdateSupplyCategoryDto extends PartialType(
  CreateSupplyCategoryDto,
) {
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
