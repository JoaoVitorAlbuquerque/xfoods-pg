import { Injectable, NotFoundException } from '@nestjs/common';
import { IngredientsRepository } from 'src/shared/database/repositories/ingredients.repositories';

@Injectable()
export class ValidateIngredientOwnershipService {
  constructor(private readonly ingredientsRepo: IngredientsRepository) {}

  async validate(userId: string, ingredientId: string) {
    const isOwner = await this.ingredientsRepo.findFirst({
      where: { userId, id: ingredientId },
    });

    if (!isOwner) {
      throw new NotFoundException('Ingredient not found.');
    }
  }
}
