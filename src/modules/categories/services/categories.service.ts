import { Injectable } from '@nestjs/common';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { CategoriesRepository } from 'src/shared/database/repositories/categories.repositories';
import { ValidateCategoryOwnershipService } from './validate-category-ownership.service';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoriesRepo: CategoriesRepository,
    private readonly validateCategoryOwnershipService: ValidateCategoryOwnershipService,
  ) {}

  create(userId: string, createCategoryDto: CreateCategoryDto) {
    const { name, icon } = createCategoryDto;

    return this.categoriesRepo.create({
      data: {
        userId,
        name,
        icon,
      },
    });
  }

  findAllByUserId(userId: string) {
    return this.categoriesRepo.findMany({
      where: { userId },
    });
  }

  // findOne(id: number) {
  //   return `This action returns a #${id} category`;
  // }

  async update(
    userId: string,
    categoryId: string,
    updateCategoryDto: UpdateCategoryDto,
  ) {
    await this.validateCategoryOwnershipService.validate(userId, categoryId);

    const { name, icon } = updateCategoryDto;

    return this.categoriesRepo.update({
      where: { id: categoryId },
      data: {
        userId,
        name,
        icon,
      },
    });
  }

  async remove(userId: string, categoryId: string) {
    await this.validateCategoryOwnershipService.validate(userId, categoryId);

    await this.categoriesRepo.delete({
      where: { id: categoryId },
    });

    return null;
  }
}
