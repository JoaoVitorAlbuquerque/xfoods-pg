import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersRepository } from 'src/shared/database/repositories/orders.repositories';
import { ValidateOrderOwnershipService } from './services/validate-order-ownership.service';
import { LeadsRepository } from 'src/shared/database/repositories/leads.repositories';
import { ValidateLeadOwnershipService } from '../leads/services/validate-lead-ownership.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepo: OrdersRepository,
    private readonly validateOrderOwnershipService: ValidateOrderOwnershipService,
    private readonly validateLeadOwnershipService: ValidateLeadOwnershipService,
    private readonly leadsRepo: LeadsRepository,
  ) {}

  async create(userId: string, createOrderDto: CreateOrderDto) {
    const { table, description, products } = createOrderDto;

    return this.ordersRepo.create({
      data: {
        userId,
        table,
        description,
        products: {
          create: products.map((product) => ({
            userId,
            productId: product.productId,
            size: product.size,
            quantity: product.quantity,
          })),
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
      where: { userId, restarted: false },
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
      where: { userId, table, paid: false },
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

  findOne(id: number) {
    return `This action returns a #${id} order`;
  }

  // update(userId: string, orderId: string, updateOrderDto: UpdateOrderDto) {
  //   const { description, products, table } = updateOrderDto;

  //   return this.ordersRepo.update({
  //     where: { id: orderId },
  //     data: {
  //       description,
  //       products,
  //       table,
  //     },
  //   });
  // }

  async updateOrderStatus(
    userId: string,
    orderId: string,
    updateOrderDto: UpdateOrderDto,
  ) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    const { status } = updateOrderDto;

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
    // await this.validateOrderOwnershipService.validate(userId, orderIds);

    // const { leadId } = updateOrderDto;

    await this.ordersRepo.updateMany({
      where: { id: { in: orderIds } },
      data: {
        leadId,
      },
    });

    await this.validateLeadOwnershipService.validate(userId, leadId);

    await this.leadsRepo.update({
      where: { id: leadId },
      data: {
        orders: {
          connect: orderIds.map((orderId) => ({ id: orderId })),
        },
      },
    });

    return { message: 'Orders successfully associated with the lead.' };
  }

  async updateOrderRestarted(userId: string) {
    await this.ordersRepo.updateMany({
      where: { userId },
      data: { restarted: true },
    });

    return null;
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
    const { paid, orderIds, table } = updateOrderDto;

    // const orders = await this.ordersRepo.findMany({
    //   where: { userId, id: { in: orderIds } },
    // });

    // if (orders.length !== orderIds.length) {
    //   throw new Error('Some orders do not belong to this user');
    // }

    await this.ordersRepo.updateMany({
      where: { userId, table, id: { in: orderIds } },
      data: { paid },
    });

    return null;
  }

  async remove(userId: string, orderId: string) {
    await this.validateOrderOwnershipService.validate(userId, orderId);

    await this.ordersRepo.delete({
      where: { id: orderId },
    });

    return null;
  }
}
