import { IsBoolean } from 'class-validator';

export class SetSupplyActiveDto {
  @IsBoolean()
  active: boolean;
}
