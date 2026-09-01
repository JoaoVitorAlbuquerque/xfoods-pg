import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateSupplyCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;
}
