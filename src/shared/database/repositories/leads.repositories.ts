import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { PrismaService } from '../prisma.service';

@Injectable()
export class LeadsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  create(updateLeadDto: Prisma.LeadCreateArgs) {
    return this.prismaService.lead.create(updateLeadDto);
  }

  findMany(findUniqueDto: Prisma.LeadFindManyArgs) {
    return this.prismaService.lead.findMany(findUniqueDto);
  }

  findFirst(findFirstDto: Prisma.LeadFindFirstArgs) {
    return this.prismaService.lead.findFirst(findFirstDto);
  }

  findUnique(findUniqueDto: Prisma.LeadFindUniqueArgs) {
    return this.prismaService.lead.findUnique(findUniqueDto);
  }

  update(updateLeadDto: Prisma.LeadUpdateArgs) {
    return this.prismaService.lead.update(updateLeadDto);
  }

  delete(deleteLeadDto: Prisma.LeadDeleteArgs) {
    return this.prismaService.lead.delete(deleteLeadDto);
  }
}
