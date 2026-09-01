import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { UpdateStockSettingsDto } from '../dto/update-stock-settings.dto';

const DEFAULTS = {
  // Padrão restritivo para as operações manuais: uma saída maior que o saldo
  // costuma ser erro de digitação, e é melhor recusar na hora do que descobrir
  // depois pelo inventário. A baixa automática da venda passa por cima com
  // `forceNegative`, para não travar o caixa.
  allowNegativeStock: false,
};

@Injectable()
export class StockSettingsService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Ausência de registro significa "padrões", não "usuário sem configuração":
   * ninguém precisa configurar estoque antes de usar estoque.
   */
  async get(userId: string) {
    const settings = await this.prismaService.stockSettings.findUnique({
      where: { userId },
    });

    return {
      allowNegativeStock:
        settings?.allowNegativeStock ?? DEFAULTS.allowNegativeStock,
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  async allowsNegativeStock(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const client = tx ?? this.prismaService;

    const settings = await client.stockSettings.findUnique({
      where: { userId },
      select: { allowNegativeStock: true },
    });

    return settings?.allowNegativeStock ?? DEFAULTS.allowNegativeStock;
  }

  async update(userId: string, dto: UpdateStockSettingsDto) {
    const settings = await this.prismaService.stockSettings.upsert({
      where: { userId },
      create: {
        userId,
        allowNegativeStock:
          dto.allowNegativeStock ?? DEFAULTS.allowNegativeStock,
      },
      update: {
        ...(dto.allowNegativeStock === undefined
          ? {}
          : { allowNegativeStock: dto.allowNegativeStock }),
      },
    });

    return {
      allowNegativeStock: settings.allowNegativeStock,
      updatedAt: settings.updatedAt,
    };
  }
}
