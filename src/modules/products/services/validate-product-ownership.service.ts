import { Injectable, NotFoundException } from '@nestjs/common';
import { ProductsRepository } from 'src/shared/database/repositories/products.repositories';

@Injectable()
export class ValidateProductOwnershipService {
  constructor(private readonly productsRepo: ProductsRepository) {}

  async validate(userId: string, productId: string) {
    const isOwner = await this.productsRepo.findFirst({
      where: { userId, id: productId },
    });

    if (!isOwner) {
      throw new NotFoundException('Product not found.');
    }
  }
}
