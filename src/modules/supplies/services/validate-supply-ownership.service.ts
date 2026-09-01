import { Injectable, NotFoundException } from '@nestjs/common';
import { Supply } from '@prisma/client';

import { SuppliesRepository } from 'src/shared/database/repositories/supplies.repositories';

@Injectable()
export class ValidateSupplyOwnershipService {
  constructor(private readonly suppliesRepo: SuppliesRepository) {}

  async validate(userId: string, supplyId: string): Promise<Supply> {
    const supply = await this.suppliesRepo.findFirst({
      where: { userId, id: supplyId },
    });

    if (!supply) {
      throw new NotFoundException('Supply not found.');
    }

    return supply as Supply;
  }
}
