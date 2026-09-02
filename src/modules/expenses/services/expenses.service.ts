import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CostNature, Prisma } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  DateWindow,
  ExpenseOccurrence,
  ExpenseRecurrenceService,
} from './expense-recurrence.service';
import { CreateExpenseDto } from '../dto/create-expense.dto';
import { UpdateExpenseDto } from '../dto/update-expense.dto';
import {
  ExpensePeriodDto,
  ListExpensesDto,
} from '../dto/list-expenses.dto';

const EXPENSE_INCLUDE = {
  category: { select: { id: true, name: true, nature: true } },
} satisfies Prisma.ExpenseInclude;

type ExpenseWithCategory = Prisma.ExpenseGetPayload<{
  include: typeof EXPENSE_INCLUDE;
}>;

/** Uma despesa com as competências que ela gera na janela pedida. */
export type ExpandedExpense = {
  expense: ExpenseWithCategory;
  occurrences: ExpenseOccurrence[];
  total: Prisma.Decimal;
};

const MONEY_SCALE = 2;

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly categoriesService: ExpenseCategoriesService,
    private readonly recurrenceService: ExpenseRecurrenceService,
  ) {}

  // ---------------------------------------------------------------------------
  // Leitura
  // ---------------------------------------------------------------------------

  findAllByUserId(userId: string, filters: ListExpensesDto) {
    const period =
      filters.from || filters.to
        ? this.resolvePeriod({ from: filters.from, to: filters.to })
        : null;

    return this.prismaService.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        ...(filters.search
          ? {
              description: {
                contains: filters.search.trim(),
                mode: 'insensitive',
              },
            }
          : {}),
        ...(filters.expenseCategoryId
          ? { expenseCategoryId: filters.expenseCategoryId }
          : {}),
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.recurrence ? { recurrence: filters.recurrence } : {}),
        ...(filters.nature ? { category: { nature: filters.nature } } : {}),
        ...(filters.active === undefined
          ? {}
          : { active: filters.active === 'true' }),
        // Recorte por vigência, não por cadastro: entra quem tem vigência
        // cruzando a janela. Uma despesa de janeiro sem fim aparece em março.
        ...(period
          ? {
              startDate: { lte: period.to },
              AND: [
                { OR: [{ endDate: null }, { endDate: { gte: period.from } }] },
                {
                  OR: [
                    { deactivatedAt: null },
                    { deactivatedAt: { gte: period.from } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: [{ active: 'desc' }, { description: 'asc' }],
    });
  }

  async findOne(userId: string, expenseId: string) {
    const expense = await this.findOneOrFail(userId, expenseId);
    const window = this.recurrenceService.monthWindow();

    return {
      ...expense,
      // Prévia da competência corrente, para a tela não precisar recalcular.
      currentPeriod: {
        ...window,
        occurrences: this.recurrenceService.expand(expense, window),
      },
    };
  }

  /**
   * Competências de todas as despesas na janela.
   *
   * É a base dos relatórios e do rateio: nada aqui olha para a data de
   * cadastro, só para a vigência declarada.
   */
  async expandForPeriod(
    userId: string,
    window: DateWindow,
    filters: {
      onlyIncludedInAllocation?: boolean;
      onlyIndirect?: boolean;
      includeFixed?: boolean;
      includeVariable?: boolean;
    } = {},
  ): Promise<ExpandedExpense[]> {
    const expenses = await this.prismaService.expense.findMany({
      where: {
        userId,
        deletedAt: null,
        startDate: { lte: window.to },
        ...(filters.onlyIncludedInAllocation
          ? { includeInAllocation: true }
          : {}),
        // Categoria marcada como custo direto fica de fora do rateio: a ficha
        // técnica já mede esse custo, e somar aqui o contaria duas vezes.
        ...(filters.onlyIndirect
          ? {
              OR: [
                { expenseCategoryId: null },
                { category: { nature: CostNature.INDIRECT } },
              ],
            }
          : {}),
      },
      include: EXPENSE_INCLUDE,
      orderBy: { description: 'asc' },
    });

    const expanded: ExpandedExpense[] = [];

    for (const expense of expenses) {
      if (filters.includeFixed === false && expense.type === 'FIXED') continue;
      if (filters.includeVariable === false && expense.type === 'VARIABLE') {
        continue;
      }

      const occurrences = this.recurrenceService.expand(expense, window);

      if (occurrences.length === 0) {
        continue;
      }

      expanded.push({
        expense,
        occurrences,
        total: occurrences
          .reduce(
            (sum, occurrence) => sum.add(occurrence.amount),
            new Prisma.Decimal(0),
          )
          .toDecimalPlaces(MONEY_SCALE),
      });
    }

    return expanded;
  }

  /** Extrato de competências do período, linha a linha. */
  async getOccurrences(userId: string, filters: ExpensePeriodDto) {
    const window = this.resolvePeriod(filters);
    const expanded = await this.expandForPeriod(userId, window);

    const items = expanded
      .flatMap(({ expense, occurrences }) =>
        occurrences.map((occurrence) => ({
          expenseId: expense.id,
          description: expense.description,
          category: expense.category,
          type: expense.type,
          recurrence: expense.recurrence,
          competenceDate: occurrence.competenceDate,
          amount: occurrence.amount,
        })),
      )
      .sort(
        (a, b) =>
          a.competenceDate.getTime() - b.competenceDate.getTime() ||
          a.description.localeCompare(b.description),
      );

    return {
      period: window,
      items,
      summary: {
        occurrences: items.length,
        expenses: expanded.length,
        total: items
          .reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0))
          .toDecimalPlaces(MONEY_SCALE),
      },
    };
  }

  /** Total do período quebrado por categoria, tipo e periodicidade. */
  async getSummary(userId: string, filters: ExpensePeriodDto) {
    const window = this.resolvePeriod(filters);
    const expanded = await this.expandForPeriod(userId, window);

    const byCategory = new Map<
      string,
      { categoryId: string | null; name: string; nature: CostNature; total: Prisma.Decimal }
    >();
    const byType = new Map<string, Prisma.Decimal>();
    const byRecurrence = new Map<string, Prisma.Decimal>();

    let total = new Prisma.Decimal(0);

    for (const { expense, total: expenseTotal } of expanded) {
      total = total.add(expenseTotal);

      const key = expense.expenseCategoryId ?? 'SEM_CATEGORIA';
      const current = byCategory.get(key) ?? {
        categoryId: expense.expenseCategoryId,
        name: expense.category?.name ?? 'Sem categoria',
        nature: expense.category?.nature ?? CostNature.INDIRECT,
        total: new Prisma.Decimal(0),
      };

      current.total = current.total.add(expenseTotal);
      byCategory.set(key, current);

      byType.set(
        expense.type,
        (byType.get(expense.type) ?? new Prisma.Decimal(0)).add(expenseTotal),
      );
      byRecurrence.set(
        expense.recurrence,
        (byRecurrence.get(expense.recurrence) ?? new Prisma.Decimal(0)).add(
          expenseTotal,
        ),
      );
    }

    return {
      period: window,
      total: total.toDecimalPlaces(MONEY_SCALE),
      byCategory: [...byCategory.values()].sort((a, b) =>
        b.total.comparedTo(a.total),
      ),
      byType: Object.fromEntries(byType.entries()),
      byRecurrence: Object.fromEntries(byRecurrence.entries()),
      expenses: expanded.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Escrita
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreateExpenseDto) {
    if (dto.expenseCategoryId) {
      await this.categoriesService.findOneOrFail(userId, dto.expenseCategoryId);
    }

    const startDate = this.recurrenceService.toDateOnly(dto.startDate);
    const endDate = dto.endDate
      ? this.recurrenceService.toDateOnly(dto.endDate)
      : null;

    this.assertDateOrder(startDate, endDate);
    this.assertPositiveAmount(dto.amount);

    return this.prismaService.expense.create({
      data: {
        userId,
        expenseCategoryId: dto.expenseCategoryId ?? null,
        description: dto.description.trim(),
        type: dto.type ?? 'FIXED',
        recurrence: dto.recurrence ?? 'MONTHLY',
        amount: new Prisma.Decimal(dto.amount),
        startDate,
        endDate,
        includeInAllocation: dto.includeInAllocation ?? true,
        notes: dto.notes?.trim(),
      },
      include: EXPENSE_INCLUDE,
    });
  }

  async update(userId: string, expenseId: string, dto: UpdateExpenseDto) {
    const current = await this.findOneOrFail(userId, expenseId);

    if (dto.expenseCategoryId) {
      await this.categoriesService.findOneOrFail(userId, dto.expenseCategoryId);
    }

    const startDate =
      dto.startDate === undefined
        ? current.startDate
        : this.recurrenceService.toDateOnly(dto.startDate);

    const endDate =
      dto.endDate === undefined
        ? current.endDate
        : dto.endDate === null
          ? null
          : this.recurrenceService.toDateOnly(dto.endDate);

    this.assertDateOrder(startDate, endDate);

    if (dto.amount !== undefined) {
      this.assertPositiveAmount(dto.amount);
    }

    const updated = await this.prismaService.expense.update({
      where: { id: expenseId },
      data: {
        ...(dto.description === undefined
          ? {}
          : { description: dto.description.trim() }),
        ...(dto.expenseCategoryId === undefined
          ? {}
          : { expenseCategoryId: dto.expenseCategoryId }),
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.recurrence === undefined ? {} : { recurrence: dto.recurrence }),
        ...(dto.amount === undefined
          ? {}
          : { amount: new Prisma.Decimal(dto.amount) }),
        ...(dto.startDate === undefined ? {} : { startDate }),
        ...(dto.endDate === undefined ? {} : { endDate }),
        ...(dto.includeInAllocation === undefined
          ? {}
          : { includeInAllocation: dto.includeInAllocation }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes?.trim() ?? null }),
      },
      include: EXPENSE_INCLUDE,
    });

    return { ...updated, warnings: this.warnAboutRewrittenHistory(dto, current) };
  }

  /**
   * Desativar carimba a data. Sem o carimbo, desligar o aluguel hoje zeraria o
   * custo de janeiro no relatório de janeiro — o passado não muda porque a
   * despesa acabou.
   */
  async setActive(userId: string, expenseId: string, active: boolean) {
    await this.findOneOrFail(userId, expenseId);

    return this.prismaService.expense.update({
      where: { id: expenseId },
      data: {
        active,
        deactivatedAt: active ? null : new Date(),
      },
      include: EXPENSE_INCLUDE,
    });
  }

  /**
   * Exclusão lógica. Uma despesa apagada de verdade tornaria irreproduzível o
   * custo dos meses em que ela valeu.
   */
  async remove(userId: string, expenseId: string) {
    await this.findOneOrFail(userId, expenseId);

    await this.prismaService.expense.update({
      where: { id: expenseId },
      data: { deletedAt: new Date(), active: false, deactivatedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Apoio
  // ---------------------------------------------------------------------------

  /** Janela pedida, ou o mês corrente. */
  resolvePeriod(filters: ExpensePeriodDto): DateWindow {
    if (!filters.from && !filters.to) {
      return this.recurrenceService.monthWindow();
    }

    const from = filters.from
      ? this.recurrenceService.toDateOnly(filters.from)
      : this.recurrenceService.monthWindow(
          this.recurrenceService.toDateOnly(filters.to),
        ).from;

    const to = filters.to
      ? this.recurrenceService.toDateOnly(filters.to)
      : this.recurrenceService.monthWindow(from).to;

    if (to < from) {
      throw new BadRequestException(
        'The end of the period must not be earlier than its start.',
      );
    }

    return { from, to };
  }

  async findOneOrFail(userId: string, expenseId: string) {
    const expense = await this.prismaService.expense.findFirst({
      where: { id: expenseId, userId, deletedAt: null },
      include: EXPENSE_INCLUDE,
    });

    if (!expense) {
      throw new NotFoundException('Expense not found.');
    }

    return expense;
  }

  private assertDateOrder(startDate: Date, endDate: Date | null) {
    if (endDate && endDate < startDate) {
      throw new BadRequestException(
        'endDate must not be earlier than startDate.',
      );
    }
  }

  /**
   * Valor sempre positivo, checado aqui e não só no DTO.
   *
   * Um valor negativo viraria custo indireto negativo e, dividido pelas
   * unidades vendidas, um custo por unidade negativo — o rateio ficaria errado
   * em silêncio. Despesa que entra dinheiro é receita, e receita não é assunto
   * deste módulo.
   */
  private assertPositiveAmount(amount: Prisma.Decimal | string | number) {
    if (new Prisma.Decimal(amount).lte(0)) {
      throw new BadRequestException(
        'Expense amount must be greater than zero.',
      );
    }
  }

  /**
   * Alterar o valor reescreve o custo de todas as competências passadas.
   *
   * É legítimo para corrigir um erro de digitação e é errado para um reajuste.
   * O sistema não tem como distinguir os dois, então avisa em vez de escolher.
   */
  private warnAboutRewrittenHistory(
    dto: UpdateExpenseDto,
    current: { amount: Prisma.Decimal; startDate: Date },
  ): string[] {
    if (dto.amount === undefined) {
      return [];
    }

    if (new Prisma.Decimal(dto.amount).equals(current.amount)) {
      return [];
    }

    const currentMonthStart = this.recurrenceService.monthWindow().from;

    if (current.startDate >= currentMonthStart) {
      return [];
    }

    return [
      'O valor foi alterado numa despesa que já tinha competências passadas: ' +
        'o custo dos meses anteriores foi reescrito. Para um reajuste, encerre ' +
        'esta despesa com endDate e cadastre outra a partir da nova vigência.',
    ];
  }
}
