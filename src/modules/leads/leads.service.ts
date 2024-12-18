import { ConflictException, Injectable } from '@nestjs/common';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';
import { LeadsRepository } from 'src/shared/database/repositories/leads.repositories';
import { ValidateLeadOwnershipService } from './services/validate-lead-ownership.service';

@Injectable()
export class LeadsService {
  constructor(
    private readonly leadsRepo: LeadsRepository,
    private readonly validateLeadOwnershipService: ValidateLeadOwnershipService,
  ) {}

  async create(userId: string, createLeadDto: CreateLeadDto) {
    const { name, email, phone, address } = createLeadDto;

    const emailTaken = await this.leadsRepo.findUnique({
      where: { email },
      select: { id: true },
    });

    if (emailTaken) {
      throw new ConflictException('This e-mail is already in use.');
    }

    const phoneTaken = await this.leadsRepo.findUnique({
      where: { phone },
      select: { id: true },
    });

    if (phoneTaken) {
      throw new ConflictException('This phone is already in use.');
    }

    return this.leadsRepo.create({
      data: {
        userId,
        name,
        email,
        phone,
        address,
      },
    });
  }

  findAllByUserId(userId: string) {
    return this.leadsRepo.findMany({
      where: { userId },
      include: {
        orders: {
          include: {
            products: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });
  }

  findAllOrdersByLeads(userId: string, leadId: string) {
    return this.leadsRepo.findMany({
      where: { userId, id: leadId },
      include: {
        orders: {
          include: {
            products: {
              include: {
                product: true,
              },
            },
          },
        },
      },
    });
  }

  // findOne(id: number) {
  //   return `This action returns a #${id} lead`;
  // }

  async update(userId: string, leadId: string, updateLeadDto: UpdateLeadDto) {
    await this.validateLeadOwnershipService.validate(userId, leadId);

    const { name, email, phone, address } = updateLeadDto;

    return this.leadsRepo.update({
      where: { id: leadId },
      data: { userId, name, email, phone, address },
    });
  }

  async remove(userId: string, leadId: string) {
    await this.validateLeadOwnershipService.validate(userId, leadId);

    await this.leadsRepo.delete({
      where: { id: leadId },
    });

    return null;
  }
}
