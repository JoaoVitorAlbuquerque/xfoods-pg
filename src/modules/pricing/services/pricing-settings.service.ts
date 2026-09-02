import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from 'src/shared/database/prisma.service';
import { PricingPercentages } from './pricing-calculator.service';
import {
  PricingQueryDto,
  UpdatePricingSettingsDto,
} from '../dto/pricing.dto';

/**
 * Margem de 30% é um ponto de partida comum, não uma regra — e é o único que
 * tem um padrão diferente de zero, porque uma margem zerada faria o preço
 * recomendado nascer igual ao custo e parecer defeito.
 *
 * Imposto e taxa nascem em ZERO de propósito: não dá para adivinhar o regime
 * tributário nem a adquirente de ninguém, e um número inventado aqui sairia
 * como preço recomendado sem que nada avisasse.
 */
const DEFAULTS = {
  desiredMarginPercent: 30,
  taxPercent: 0,
  cardFeePercent: 0,
  deliveryFeePercent: 0,
  otherFeesPercent: 0,
};

@Injectable()
export class PricingSettingsService {
  constructor(private readonly prismaService: PrismaService) {}

  async get(userId: string) {
    const settings = await this.prismaService.pricingSettings.findUnique({
      where: { userId },
    });

    return {
      desiredMarginPercent: new Prisma.Decimal(
        settings?.desiredMarginPercent ?? DEFAULTS.desiredMarginPercent,
      ),
      taxPercent: new Prisma.Decimal(settings?.taxPercent ?? DEFAULTS.taxPercent),
      cardFeePercent: new Prisma.Decimal(
        settings?.cardFeePercent ?? DEFAULTS.cardFeePercent,
      ),
      deliveryFeePercent: new Prisma.Decimal(
        settings?.deliveryFeePercent ?? DEFAULTS.deliveryFeePercent,
      ),
      otherFeesPercent: new Prisma.Decimal(
        settings?.otherFeesPercent ?? DEFAULTS.otherFeesPercent,
      ),
      /** Falso significa "ninguém configurou ainda", não "tudo zerado". */
      configured: settings !== null,
      updatedAt: settings?.updatedAt ?? null,
    };
  }

  async update(userId: string, dto: UpdatePricingSettingsDto) {
    await this.prismaService.pricingSettings.upsert({
      where: { userId },
      create: {
        userId,
        desiredMarginPercent: new Prisma.Decimal(
          dto.desiredMarginPercent ?? DEFAULTS.desiredMarginPercent,
        ),
        taxPercent: new Prisma.Decimal(dto.taxPercent ?? DEFAULTS.taxPercent),
        cardFeePercent: new Prisma.Decimal(
          dto.cardFeePercent ?? DEFAULTS.cardFeePercent,
        ),
        deliveryFeePercent: new Prisma.Decimal(
          dto.deliveryFeePercent ?? DEFAULTS.deliveryFeePercent,
        ),
        otherFeesPercent: new Prisma.Decimal(
          dto.otherFeesPercent ?? DEFAULTS.otherFeesPercent,
        ),
      },
      update: {
        ...this.optionalDecimal('desiredMarginPercent', dto.desiredMarginPercent),
        ...this.optionalDecimal('taxPercent', dto.taxPercent),
        ...this.optionalDecimal('cardFeePercent', dto.cardFeePercent),
        ...this.optionalDecimal('deliveryFeePercent', dto.deliveryFeePercent),
        ...this.optionalDecimal('otherFeesPercent', dto.otherFeesPercent),
      },
    });

    return this.get(userId);
  }

  /**
   * Percentuais gravados, com o que vier na consulta sobrescrevendo.
   *
   * Sobrescrever por requisição é o que permite precificar canal a canal — ou
   * simular "e se a margem fosse 40%" — sem gravar nada nem duplicar cadastro.
   */
  async resolvePercentages(
    userId: string,
    overrides: PricingQueryDto = {},
  ): Promise<PricingPercentages & { source: Record<string, 'SETTINGS' | 'QUERY'> }> {
    const settings = await this.get(userId);

    const pick = (
      override: string | number | undefined,
      stored: Prisma.Decimal,
    ) =>
      override === undefined
        ? { value: stored, from: 'SETTINGS' as const }
        : { value: new Prisma.Decimal(override), from: 'QUERY' as const };

    const margin = pick(overrides.marginPercent, settings.desiredMarginPercent);
    const tax = pick(overrides.taxPercent, settings.taxPercent);
    const card = pick(overrides.cardFeePercent, settings.cardFeePercent);
    const delivery = pick(
      overrides.deliveryFeePercent,
      settings.deliveryFeePercent,
    );
    const other = pick(overrides.otherFeesPercent, settings.otherFeesPercent);

    return {
      marginPercent: margin.value,
      taxPercent: tax.value,
      cardFeePercent: card.value,
      deliveryFeePercent: delivery.value,
      otherFeesPercent: other.value,
      source: {
        marginPercent: margin.from,
        taxPercent: tax.from,
        cardFeePercent: card.from,
        deliveryFeePercent: delivery.from,
        otherFeesPercent: other.from,
      },
    };
  }

  private optionalDecimal(field: string, value: string | number | undefined) {
    return value === undefined ? {} : { [field]: new Prisma.Decimal(value) };
  }
}
