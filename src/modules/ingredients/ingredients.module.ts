import { Module } from '@nestjs/common';
import { IngredientsService } from './services/ingredients.service';
import { IngredientsController } from './ingredients.controller';
import { ValidateIngredientOwnershipService } from './services/validate-ingredient-ownership.service';

@Module({
  controllers: [IngredientsController],
  providers: [IngredientsService, ValidateIngredientOwnershipService],
  exports: [ValidateIngredientOwnershipService],
})
export class IngredientsModule {}
