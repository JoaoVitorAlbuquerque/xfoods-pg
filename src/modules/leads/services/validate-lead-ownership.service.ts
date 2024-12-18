import { Injectable, NotFoundException } from '@nestjs/common';
import { LeadsRepository } from 'src/shared/database/repositories/leads.repositories';

@Injectable()
export class ValidateLeadOwnershipService {
  constructor(private readonly leadsRepo: LeadsRepository) {}

  async validate(userId: string, leadId: string) {
    const isOwner = await this.leadsRepo.findFirst({
      where: { userId, id: leadId },
    });

    if (!isOwner) {
      throw new NotFoundException('Lead not found.');
    }
  }
}
