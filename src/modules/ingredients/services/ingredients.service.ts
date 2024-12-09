import { Injectable } from '@nestjs/common';
import { CreateIngredientDto } from '../dto/create-ingredient.dto';
import { UpdateIngredientDto } from '../dto/update-ingredient.dto';
import { IngredientsRepository } from 'src/shared/database/repositories/ingredients.repositories';
import { ValidateIngredientOwnershipService } from './validate-ingredient-ownership.service';

@Injectable()
export class IngredientsService {
  constructor(
    private readonly ingredientsRepo: IngredientsRepository,
    private readonly validateIngredientOwnershipService: ValidateIngredientOwnershipService,
  ) {}

  create(userId: string, createIngredientDto: CreateIngredientDto) {
    const { name, icon } = createIngredientDto;

    return this.ingredientsRepo.create({
      data: {
        userId,
        name,
        icon,
      },
    });
  }

  findAllByUserId(userId: string) {
    return this.ingredientsRepo.findMany({
      where: { userId },
    });
  }

  // findOne(id: number) {
  //   return `This action returns a #${id} ingredient`;
  // }

  async update(
    userId: string,
    ingredientId: string,
    updateIngredientDto: UpdateIngredientDto,
  ) {
    await this.validateIngredientOwnershipService.validate(
      userId,
      ingredientId,
    );

    const { name, icon } = updateIngredientDto;

    return this.ingredientsRepo.update({
      where: { id: ingredientId },
      data: {
        userId,
        name,
        icon,
      },
    });
  }

  async remove(userId: string, ingredientId: string) {
    await this.validateIngredientOwnershipService.validate(
      userId,
      ingredientId,
    );

    await this.ingredientsRepo.delete({
      where: { id: ingredientId },
    });

    return null;
  }
}
