import { IsNotEmpty, IsString } from 'class-validator';

export class CreateIngredientDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  icon: string;
}
