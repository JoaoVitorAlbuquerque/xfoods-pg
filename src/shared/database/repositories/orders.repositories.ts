import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(updateOrderDto: Prisma.OrderCreateArgs) {
    return this.prismaService.order.create(updateOrderDto);
  }

  findMany(findUniqueDto: Prisma.OrderFindManyArgs) {
    return this.prismaService.order.findMany(findUniqueDto);
  }

  findFirst(findFirstDto: Prisma.OrderFindFirstArgs) {
    return this.prismaService.order.findFirst(findFirstDto);
  }

  update(updateOrderDto: Prisma.OrderUpdateArgs) {
    return this.prismaService.order.update(updateOrderDto);
  }

  updateMany(updateManyOrderDto: Prisma.OrderUpdateManyArgs) {
    return this.prismaService.order.updateMany(updateManyOrderDto);
  }

  delete(deleteOrderDto: Prisma.OrderDeleteArgs) {
    return this.prismaService.order.delete(deleteOrderDto);
  }
}
