import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { SupplyCategoriesRepository } from 'src/shared/database/repositories/supply-categories.repositories';
import { CreateSupplyCategoryDto } from '../dto/create-supply-category.dto';
import { UpdateSupplyCategoryDto } from '../dto/update-supply-category.dto';

@Injectable()
export class SupplyCategoriesService {
  constructor(
    private readonly supplyCategoriesRepo: SupplyCategoriesRepository,
  ) {}

  findAllByUserId(userId: string) {
    return this.supplyCategoriesRepo.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { supplies: true } } },
    });
  }

  async create(userId: string, dto: CreateSupplyCategoryDto) {
    const name = dto.name.trim();

    await this.assertNameIsFree(userId, name);

    return this.supplyCategoriesRepo.create({
      data: { userId, name },
    });
  }

  async update(
    userId: string,
    categoryId: string,
    dto: UpdateSupplyCategoryDto,
  ) {
    await this.validate(userId, categoryId);

    const data: { name?: string; active?: boolean } = {};

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      await this.assertNameIsFree(userId, name, categoryId);
      data.name = name;
    }

    if (dto.active !== undefined) {
      data.active = dto.active;
    }

    return this.supplyCategoriesRepo.update({
      where: { id: categoryId },
      data,
    });
  }

  /**
   * Desativa em vez de apagar: a categoria já pode estar classificando insumos,
   * e o vínculo é `SetNull` — apagar deixaria os insumos sem classificação de
   * forma silenciosa.
   */
  async remove(userId: string, categoryId: string) {
    await this.validate(userId, categoryId);

    await this.supplyCategoriesRepo.update({
      where: { id: categoryId },
      data: { active: false },
    });

    return null;
  }

  private async validate(userId: string, categoryId: string) {
    const category = await this.supplyCategoriesRepo.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Supply category not found.');
    }

    return category;
  }

  private async assertNameIsFree(
    userId: string,
    name: string,
    exceptId?: string,
  ) {
    const clashing = await this.supplyCategoriesRepo.findFirst({
      where: { userId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });

    if (clashing) {
      throw new ConflictException(
        `You already have a supply category named ${name}.`,
      );
    }
  }
}
