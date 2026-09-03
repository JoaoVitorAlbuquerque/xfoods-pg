import { Injectable } from '@nestjs/common';
import { OrderType, Prisma } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';

export type DateWindow = { from: Date; to: Date };

export type SalesFilters = {
  productId?: string;
  categoryId?: string;
};

export type SalesTotals = {
  items: number;
  units: Prisma.Decimal;
  revenue: Prisma.Decimal;
  /** Custo direto congelado na venda. Ver a ressalva sobre snapshot abaixo. */
  directCost: Prisma.Decimal;
  itemsWithoutCostSnapshot: number;
  unitsWithoutCostSnapshot: Prisma.Decimal;
};

export type ProductSales = SalesTotals & {
  productId: string;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  currentPrice: Prisma.Decimal;
};

/**
 * Números de venda por agregação no banco.
 *
 * NENHUM método aqui carrega linha de venda para a memória. O faturamento sai
 * de um SUM e o ranking de produto sai de um GROUP BY — o que volta é uma linha
 * por produto, ou seja, do tamanho do cardápio, não do movimento. Um mês com
 * cinquenta mil itens vendidos devolve as mesmas dezenas de linhas que um mês
 * com cinquenta.
 *
 * O custo direto vem de `ProductOrder.recipeTotalCost`, congelado na baixa da
 * venda. É por isso que este relatório não precisa reabrir ficha técnica: o
 * custo daquele dia já está gravado na linha. Vendas anteriores à baixa
 * automática e itens vendidos sem ficha não têm o snapshot, e a contagem deles
 * volta junto — sem ela, o custo apareceria menor do que foi e a margem, maior.
 */
@Injectable()
export class SalesAggregationService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Vendas que contam: pagas, não canceladas, não excluídas, com a data de
   * pagamento dentro da janela. É o mesmo recorte de competência que o rateio
   * usa, para faturamento e custo indireto falarem do mesmo período.
   */
  where(
    userId: string,
    window: DateWindow,
    filters: SalesFilters = {},
  ): Prisma.ProductOrderWhereInput {
    return {
      userId,
      ...(filters.productId ? { productId: filters.productId } : {}),
      ...(filters.categoryId
        ? { product: { categoryId: filters.categoryId } }
        : {}),
      order: {
        userId,
        paid: true,
        deletedAt: null,
        status: { not: OrderType.CANCELED },
        paidAt: { gte: window.from, lte: this.endOfDay(window.to) },
      },
    };
  }

  /** Faturamento, quantidade e custo direto do período inteiro. */
  async totals(
    userId: string,
    window: DateWindow,
    filters: SalesFilters = {},
  ): Promise<SalesTotals> {
    const where = this.where(userId, window, filters);

    const [all, missing] = await Promise.all([
      this.prismaService.productOrder.aggregate({
        where,
        _sum: { quantity: true, totalPrice: true, recipeTotalCost: true },
        _count: { _all: true },
      }),
      this.prismaService.productOrder.aggregate({
        where: { ...where, recipeTotalCost: null },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items: all._count._all,
      units: new Prisma.Decimal(all._sum.quantity ?? 0),
      revenue: new Prisma.Decimal(all._sum.totalPrice ?? 0),
      directCost: new Prisma.Decimal(all._sum.recipeTotalCost ?? 0),
      itemsWithoutCostSnapshot: missing._count._all,
      unitsWithoutCostSnapshot: new Prisma.Decimal(missing._sum.quantity ?? 0),
    };
  }

  /**
   * Uma linha por produto vendido.
   *
   * O GROUP BY é feito pelo banco; o que sobe para a aplicação já é o
   * resultado. A ordenação e o recorte das listas de ranking acontecem depois,
   * sobre essas poucas linhas, porque margem e lucro dependem de rateio e
   * percentuais que não existem no SQL.
   */
  async byProduct(
    userId: string,
    window: DateWindow,
    filters: SalesFilters = {},
  ): Promise<ProductSales[]> {
    const where = this.where(userId, window, filters);

    const [groups, missing] = await Promise.all([
      this.prismaService.productOrder.groupBy({
        by: ['productId'],
        where,
        _sum: { quantity: true, totalPrice: true, recipeTotalCost: true },
        _count: { _all: true },
      }),
      this.prismaService.productOrder.groupBy({
        by: ['productId'],
        where: { ...where, recipeTotalCost: null },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
    ]);

    if (groups.length === 0) {
      return [];
    }

    // Uma consulta a mais para os nomes, limitada aos produtos que apareceram
    // no agrupamento — dezenas de linhas, não o movimento.
    const products = await this.prismaService.product.findMany({
      where: { userId, id: { in: groups.map((group) => group.productId) } },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        category: { select: { name: true } },
      },
    });

    const byId = new Map(products.map((product) => [product.id, product]));
    const missingById = new Map(
      missing.map((group) => [group.productId, group]),
    );

    return groups.map((group) => {
      const product = byId.get(group.productId);
      const gap = missingById.get(group.productId);

      return {
        productId: group.productId,
        productName: product?.name ?? group.productId,
        categoryId: product?.categoryId ?? null,
        categoryName: product?.category?.name ?? null,
        currentPrice: new Prisma.Decimal(product?.price ?? 0),
        items: group._count._all,
        units: new Prisma.Decimal(group._sum.quantity ?? 0),
        revenue: new Prisma.Decimal(group._sum.totalPrice ?? 0),
        directCost: new Prisma.Decimal(group._sum.recipeTotalCost ?? 0),
        itemsWithoutCostSnapshot: gap?._count._all ?? 0,
        unitsWithoutCostSnapshot: new Prisma.Decimal(gap?._sum.quantity ?? 0),
      };
    });
  }

  /**
   * A janela vem como data pura. Sem empurrar o fim para o último instante do
   * dia, tudo que foi vendido depois da meia-noite do último dia ficaria fora.
   */
  private endOfDay(date: Date) {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
}
