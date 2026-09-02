import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { UpdateStockSettingsDto } from '../dto/update-stock-settings.dto';

const DEFAULTS = {
  // Padrão restritivo: uma saída maior que o saldo costuma ser erro de
  // digitação, e é melhor recusar na hora do que descobrir pelo inventário.
  //
  // ATENÇÃO OPERACIONAL: isto vale também para a baixa automática da venda.
  // Com a trava ligada, faltar insumo cadastrado impede FECHAR A CONTA — a
  // transação inteira volta atrás e o pagamento não é confirmado. Quem opera
  // caixa com estoque ainda em ajuste costuma querer isto ligado em `true`,
  // registrando o saldo negativo como sinal de conferência pendente.
  allowNegativeStock: false,
  // Padrão permissivo: um cardápio sem fichas ainda precisa poder vender.
  // Quem já mapeou as fichas desliga isto e passa a exigir ficha para fechar.
  allowSaleWithoutRecipe: true,
  // 5% é o ponto de partida do relatório Estimado x Real: abaixo disso o
  // desvio costuma ser porção servida a olho, não perda que valha apurar.
  stockConsumptionTolerancePercentage: 5,
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
      allowSaleWithoutRecipe:
        settings?.allowSaleWithoutRecipe ?? DEFAULTS.allowSaleWithoutRecipe,
      stockConsumptionTolerancePercentage: new Prisma.Decimal(
        settings?.stockConsumptionTolerancePercentage ??
          DEFAULTS.stockConsumptionTolerancePercentage,
      ),
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  /** Margem aceitável de desvio entre consumo estimado e real, em porcento. */
  async consumptionTolerance(
    userId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const client = tx ?? this.prismaService;

    const settings = await client.stockSettings.findUnique({
      where: { userId },
      select: { stockConsumptionTolerancePercentage: true },
    });

    return new Prisma.Decimal(
      settings?.stockConsumptionTolerancePercentage ??
        DEFAULTS.stockConsumptionTolerancePercentage,
    );
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
        allowSaleWithoutRecipe:
          dto.allowSaleWithoutRecipe ?? DEFAULTS.allowSaleWithoutRecipe,
        stockConsumptionTolerancePercentage: new Prisma.Decimal(
          dto.stockConsumptionTolerancePercentage ??
            DEFAULTS.stockConsumptionTolerancePercentage,
        ),
      },
      update: {
        ...(dto.allowNegativeStock === undefined
          ? {}
          : { allowNegativeStock: dto.allowNegativeStock }),
        ...(dto.allowSaleWithoutRecipe === undefined
          ? {}
          : { allowSaleWithoutRecipe: dto.allowSaleWithoutRecipe }),
        ...(dto.stockConsumptionTolerancePercentage === undefined
          ? {}
          : {
              stockConsumptionTolerancePercentage: new Prisma.Decimal(
                dto.stockConsumptionTolerancePercentage,
              ),
            }),
      },
    });

    return {
      allowNegativeStock: settings.allowNegativeStock,
      allowSaleWithoutRecipe: settings.allowSaleWithoutRecipe,
      stockConsumptionTolerancePercentage:
        settings.stockConsumptionTolerancePercentage,
      updatedAt: settings.updatedAt,
    };
  }
}
