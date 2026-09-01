import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { SuppliersRepository } from 'src/shared/database/repositories/suppliers.repositories';
import { CreateSupplierDto } from '../dto/create-supplier.dto';
import { UpdateSupplierDto } from '../dto/update-supplier.dto';

@Injectable()
export class SuppliersService {
  constructor(private readonly suppliersRepo: SuppliersRepository) {}

  findAllByUserId(userId: string, search?: string) {
    return this.suppliersRepo.findMany({
      where: {
        userId,
        ...(search
          ? { name: { contains: search.trim(), mode: 'insensitive' } }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { purchases: true } } },
    });
  }

  async create(userId: string, dto: CreateSupplierDto) {
    const name = dto.name.trim();

    await this.assertNameIsFree(userId, name);

    return this.suppliersRepo.create({
      data: {
        userId,
        name,
        document: dto.document?.trim(),
        phone: dto.phone?.trim(),
        email: dto.email?.trim(),
        notes: dto.notes?.trim(),
      },
    });
  }

  async update(userId: string, supplierId: string, dto: UpdateSupplierDto) {
    await this.validate(userId, supplierId);

    if (dto.name !== undefined) {
      await this.assertNameIsFree(userId, dto.name.trim(), supplierId);
    }

    return this.suppliersRepo.update({
      where: { id: supplierId },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.document === undefined
          ? {}
          : { document: dto.document?.trim() ?? null }),
        ...(dto.phone === undefined ? {} : { phone: dto.phone?.trim() ?? null }),
        ...(dto.email === undefined ? {} : { email: dto.email?.trim() ?? null }),
        ...(dto.notes === undefined ? {} : { notes: dto.notes?.trim() ?? null }),
        ...(dto.active === undefined ? {} : { active: dto.active }),
      },
    });
  }

  /**
   * Desativa em vez de apagar: o fornecedor está amarrado a compras já
   * confirmadas e ao histórico de custo, que precisam continuar dizendo de
   * quem veio cada preço.
   */
  async remove(userId: string, supplierId: string) {
    await this.validate(userId, supplierId);

    await this.suppliersRepo.update({
      where: { id: supplierId },
      data: { active: false },
    });

    return null;
  }

  private async validate(userId: string, supplierId: string) {
    const supplier = await this.suppliersRepo.findFirst({
      where: { id: supplierId, userId },
    });

    if (!supplier) {
      throw new NotFoundException('Supplier not found.');
    }

    return supplier;
  }

  private async assertNameIsFree(
    userId: string,
    name: string,
    exceptId?: string,
  ) {
    const clashing = await this.suppliersRepo.findFirst({
      where: { userId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });

    if (clashing) {
      throw new ConflictException(
        `You already have a supplier named ${name}.`,
      );
    }
  }
}
