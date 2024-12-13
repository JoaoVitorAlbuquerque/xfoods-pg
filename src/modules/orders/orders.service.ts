import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersRepository } from 'src/shared/database/repositories/orders.repositories';
import { ValidateOrderOwnershipService } from './services/validate-order-ownership.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepo: OrdersRepository,
    private readonly validateOrderOwnershipService: ValidateOrderOwnershipService,
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
            product: true,
          },
        },
      },
    });
  }

  findAllByUserIdHistory(userId: string) {
    return this.ordersRepo.findMany({
      where: { userId, restarted: true },
      include: {
        products: {
          include: {
            product: true,
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
    const { table, paid } = updateOrderDto;

    await this.ordersRepo.updateMany({
      where: { userId, table },
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
