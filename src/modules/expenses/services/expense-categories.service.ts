import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CostNature } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import {
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from '../dto/expense-category.dto';

/**
 * Categorias sugeridas na primeira vez que o estabelecimento abre a tela.
 *
 * Semear é opcional e explícito: criar isto sozinho no cadastro do usuário
 * encheria a conta de quem não usa despesas, e apagar depois seria pior.
 */
export const SUGGESTED_EXPENSE_CATEGORIES = [
  'Aluguel',
  'Água',
  'Energia',
  'Gás',
  'Internet',
  'Salários',
  'Contador',
  'Limpeza',
  'Manutenção',
  'Marketing',
  'Sistemas',
  'Outras despesas',
];

@Injectable()
export class ExpenseCategoriesService {
  constructor(private readonly prismaService: PrismaService) {}

  findAllByUserId(userId: string) {
    return this.prismaService.expenseCategory.findMany({
      where: { userId },
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async create(userId: string, dto: CreateExpenseCategoryDto) {
    const name = dto.name.trim();

    const existing = await this.prismaService.expenseCategory.findFirst({
      where: { userId, name },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        `You already have an expense category named ${name}.`,
      );
    }

    return this.prismaService.expenseCategory.create({
      data: { userId, name, nature: dto.nature ?? CostNature.INDIRECT },
    });
  }

  async update(
    userId: string,
    categoryId: string,
    dto: UpdateExpenseCategoryDto,
  ) {
    await this.findOneOrFail(userId, categoryId);

    if (dto.name !== undefined) {
      const name = dto.name.trim();

      const clashing = await this.prismaService.expenseCategory.findFirst({
        where: { userId, name, NOT: { id: categoryId } },
        select: { id: true },
      });

      if (clashing) {
        throw new ConflictException(
          `You already have an expense category named ${name}.`,
        );
      }
    }

    return this.prismaService.expenseCategory.update({
      where: { id: categoryId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.nature === undefined ? {} : { nature: dto.nature }),
        ...(dto.active === undefined ? {} : { active: dto.active }),
      },
    });
  }

  /** Cria as categorias sugeridas que ainda não existem. Não apaga nada. */
  async seedSuggested(userId: string) {
    const existing = await this.prismaService.expenseCategory.findMany({
      where: { userId },
      select: { name: true },
    });

    const known = new Set(existing.map((category) => category.name));
    const missing = SUGGESTED_EXPENSE_CATEGORIES.filter(
      (name) => !known.has(name),
    );

    if (missing.length > 0) {
      await this.prismaService.expenseCategory.createMany({
        data: missing.map((name) => ({ userId, name })),
      });
    }

    return {
      created: missing.length,
      skipped: SUGGESTED_EXPENSE_CATEGORIES.length - missing.length,
      items: await this.findAllByUserId(userId),
    };
  }

  async findOneOrFail(userId: string, categoryId: string) {
    const category = await this.prismaService.expenseCategory.findFirst({
      where: { id: categoryId, userId },
    });

    if (!category) {
      throw new NotFoundException('Expense category not found.');
    }

    return category;
  }
}
