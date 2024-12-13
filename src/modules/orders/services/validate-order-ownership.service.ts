import { Injectable, NotFoundException } from '@nestjs/common';
import { OrdersRepository } from 'src/shared/database/repositories/orders.repositories';

@Injectable()
export class ValidateOrderOwnershipService {
  constructor(private readonly ordersRepo: OrdersRepository) {}

  async validate(userId: string, orderId: string) {
    const isOwner = await this.ordersRepo.findFirst({
      where: { userId, id: orderId },
    });

    if (!isOwner) {
      throw new NotFoundException('Order not found.');
    }
  }
}
