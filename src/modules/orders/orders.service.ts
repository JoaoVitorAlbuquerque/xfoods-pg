import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderType, Prisma } from '@prisma/client';

import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersRepository } from 'src/shared/database/repositories/orders.repositories';
import { ProductsRepository } from 'src/shared/database/repositories/products.repositories';
import { ValidateOrderOwnershipService } from './services/validate-order-ownership.service';
import { ValidateLeadOwnershipService } from '../leads/services/validate-lead-ownership.service';
import { PrismaService } from 'src/shared/database/prisma.service';
import { OrderStockService } from './services/order-stock.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly ordersRepo: OrdersRepository,
    private readonly productsRepo: ProductsRepository,
    private readonly orderStockService: OrderStockService,
    private readonly validateOrderOwnershipService: ValidateOrderOwnershipService,
    private readonly validateLeadOwnershipService: ValidateLeadOwnershipService,
  ) {}

  async create(userId: string, createOrderDto: CreateOrderDto) {
    const { table, description, products } = createOrderDto;

    if (!products || products.length === 0) {
      throw new BadRequestException('An order needs at least one product.');
    }

    const productIds = [...new Set(products.map((item) => item.productId))];

    // Busca com `userId` no filtro: é o que impede referenciar um produto de
    // outro estabelecimento. Produtos com `deleted: true` continuam aceitos de
    // propósito — um prato removido do cardápio entre a abertura da comanda e o
    // envio do pedido não pode derrubar o pedido inteiro.
    const foundProducts = await this.productsRepo.findMany({
      where: { id: { in: productIds }, userId },
      select: { id: true, price: true },
    });

    if (foundProducts.length !== productIds.length) {
      throw new NotFoundException(
        'Some products were not found for this user.',
      );
    }

    const priceByProductId = new Map(
      foundProducts.map((product) => [product.id, product.price]),
    );

    // Preço congelado no momento da venda. Sem isso, alterar o preço de um
    // prato reescreveria o faturamento de todos os meses anteriores, porque os
    // relatórios liam `product.price` atual via include.
    const items = products.map((item) => {
      const unitPrice = priceByProductId.get(item.productId);
      const quantity = item.quantity ?? 1;

      return {
        userId,
        productId: item.productId,
        size: item.size,
        quantity,
        unitPrice,
        totalPrice: unitPrice.mul(quantity),
      };
    });

    const totalAmount = items.reduce(
      (total, item) => total.add(item.totalPrice),
      new Prisma.Decimal(0),
    );

    return this.ordersRepo.create({
      data: {
        userId,
        table,
        description,
        totalAmount,
        products: {
          create: items,
        },
      },
      include: {
        products: {
          include: {
            product: true,
          },
        },
      },
    });
  }

  findAllByUserIdDashboard(userId: string) {
    return this.ordersRepo.findMany({
      where: { userId, restarted: false, deletedAt: null },
      include: {
        products: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });
  }

  findAllByUserIdHistory(
    userId: string,
    filters: { month: number; year: number },
  ) {
    return this.ordersRepo.findMany({
      where: {
        userId,
        restarted: true,
        deletedAt: null,
        createdAt: {
          gte: new Date(Date.UTC(filters.year, filters.month)),
          lt: new Date(Date.UTC(filters.year, filters.month + 1)),
        },
      },
      include: {
        lead: true,
        products: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });
  }

  findAllByUserIdFinancial(userId: string, table: number) {
    return this.ordersRepo.findMany({
      where: {
        userId,
        table,
        paid: false,
        deletedAt: null,
        canceledAt: null,
      },
      include: {
        products: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });
  }

  async updateOrderStatus(
    userId: string,
    orderId: string,
    updateOrderDto: UpdateOrderDto,
  ) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    const { status } = updateOrderDto;

    // Cancelar grava `canceledAt` e passa por regras próprias; não pode ser
    // feito por aqui, senão o pedido ficaria CANCELED sem data de cancelamento.
    if (status === OrderType.CANCELED) {
      throw new BadRequestException(
        'Use PATCH /orders/:orderId/cancel to cancel an order.',
      );
    }

    return this.ordersRepo.update({
      where: { id: orderId },
      data: {
        status,
      },
    });
  }

  async associateLeadWithOrders(
    userId: string,
    leadId: string,
    orderIds: string[],
  ) {
    if (!orderIds || orderIds.length === 0) {
      throw new BadRequestException('No orders were informed.');
    }

    await this.validateLeadOwnershipService.validate(userId, leadId);

    // A validação de posse dos pedidos estava comentada e o `updateMany`
    // filtrava só por id, sem `userId`: dava para associar pedidos de outro
    // estabelecimento a um lead próprio.
    const ownedOrders = await this.ordersRepo.findMany({
      where: { userId, id: { in: orderIds } },
      select: { id: true },
    });

    if (ownedOrders.length !== new Set(orderIds).size) {
      throw new NotFoundException('Some orders were not found for this user.');
    }

    await this.ordersRepo.updateMany({
      where: { userId, id: { in: orderIds } },
      data: { leadId },
    });

    // O `leadsRepo.update` com `connect` que existia aqui escrevia exatamente a
    // mesma coluna (`orders.lead_id`). Removido: era uma segunda escrita fora
    // de transação para o mesmo efeito.

    return { message: 'Orders successfully associated with the lead.' };
  }

  async updateOrderRestarted(userId: string) {
    // `restarted` é a flag que move o pedido do Dashboard para o History.
    // Continua arquivando também os não pagos, que é o comportamento em uso
    // hoje. O que mudou é o filtro `restarted: false`, para não reescrever as
    // linhas que já estão no histórico, e o recorte de deletados.
    //
    // A delimitação de período que os relatórios de consumo vão precisar não
    // sai daqui: sai de `paidAt`, que passou a existir nesta fase.
    const { count } = await this.ordersRepo.updateMany({
      where: { userId, restarted: false, deletedAt: null },
      data: { restarted: true },
    });

    return { restarted: count };
  }

  async updateOrderRead(userId: string, orderId: string) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    await this.ordersRepo.update({
      where: { id: orderId },
      data: { read: true },
    });

    return null;
  }

  async updateOrderPaid(userId: string, updateOrderDto: UpdateOrderDto) {
    const { orderIds, table } = updateOrderDto;
    const paid = updateOrderDto.paid ?? true;

    if (!orderIds || orderIds.length === 0) {
      throw new BadRequestException('No orders were informed.');
    }

    const ownedOrders = await this.ordersRepo.findMany({
      where: { userId, id: { in: orderIds } },
      select: { id: true },
    });

    if (ownedOrders.length !== new Set(orderIds).size) {
      throw new NotFoundException('Some orders were not found for this user.');
    }

    // Pagamento e baixa de estoque na MESMA transação. Se faltar insumo com
    // `allowNegativeStock` desligado, ou se um prato não tiver ficha com
    // `allowSaleWithoutRecipe` desligado, a transação inteira volta atrás e o
    // pagamento não é confirmado.
    return this.prismaService.$transaction(async (tx) => {
      let updated = 0;
      const alerts = [];
      let stockMovements = 0;

      for (const orderId of orderIds) {
        // `paid: !paid` no filtro torna a operação idempotente: chamar duas
        // vezes atualiza zero linhas na segunda, e a baixa não repete.
        const { count } = await tx.order.updateMany({
          where: {
            id: orderId,
            userId,
            paid: !paid,
            deletedAt: null,
            canceledAt: null,
            ...(table === undefined ? {} : { table }),
          },
          data: {
            paid,
            paidAt: paid ? new Date() : null,
          },
        });

        if (count !== 1) {
          continue;
        }

        updated += 1;

        if (paid) {
          const result = await this.orderStockService.applySale(
            userId,
            orderId,
            tx,
          );

          stockMovements += result.movements;
          alerts.push(...result.alerts);
        } else {
          // Reverter o pagamento devolve o consumo ao estoque. É o caminho de
          // alteração de venda: estorna, ajusta, cobra de novo — nunca
          // sobrescreve a movimentação anterior.
          const result = await this.orderStockService.reverseSale(
            userId,
            orderId,
            'Estorno por reversão de pagamento',
            tx,
          );

          stockMovements += result.movements;
        }
      }

      return { updated, stockMovements, alerts };
    });
  }

  async getConsumption(userId: string, orderId: string) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    return this.orderStockService.getConsumption(userId, orderId);
  }

  async cancel(userId: string, orderId: string) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    const order = await this.ordersRepo.findFirst({
      where: { userId, id: orderId },
    });

    if (order.canceledAt) {
      throw new ConflictException('Order is already canceled.');
    }

    return this.prismaService.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: orderId, userId, canceledAt: null, deletedAt: null },
        data: { status: OrderType.CANCELED, canceledAt: new Date() },
      });

      if (count !== 1) {
        throw new ConflictException(
          'Order was already canceled by another request.',
        );
      }

      // Cancelar uma venda já concluída devolve os insumos com movimentações
      // RETURN. O pagamento NÃO é tocado: devolver dinheiro é decisão de caixa
      // e o sistema não modela estorno financeiro — um pedido cancelado
      // continua marcado como pago, e a devolução se resolve fora daqui.
      const reversal = await this.orderStockService.reverseSale(
        userId,
        orderId,
        'Estorno por cancelamento do pedido',
        tx,
      );

      const canceled = await tx.order.findUnique({ where: { id: orderId } });

      return { ...canceled, stockReversal: reversal };
    });
  }

  async remove(userId: string, orderId: string) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    // Era `delete` físico, com `onDelete: Cascade` levando os itens junto — o
    // histórico da venda desaparecia. Com estoque, sumiria também a
    // rastreabilidade do movimento gerado por ela.
    await this.prismaService.$transaction(async (tx) => {
      await tx.order.updateMany({
        where: { id: orderId, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      // Um pedido excluído que já tinha baixado estoque deixaria consumo
      // fantasma: os insumos sairiam sem venda nenhuma para explicá-los.
      await this.orderStockService.reverseSale(
        userId,
        orderId,
        'Estorno por exclusão do pedido',
        tx,
      );
    });

    return null;
  }
}
