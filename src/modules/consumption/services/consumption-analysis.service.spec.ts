import { Prisma, StockMovementType } from '@prisma/client';

import {
  ConsumptionAnalysisService,
  ConsumptionClassification,
} from './consumption-analysis.service';

describe('ConsumptionAnalysisService', () => {
  const service = new ConsumptionAnalysisService();

  const compare = (
    estimated: string,
    real: string,
    unitCost = '0',
    tolerance = '5',
  ) =>
    service.compare({
      estimatedQuantity: estimated,
      realQuantity: real,
      unitCost,
      tolerancePercent: tolerance,
    });

  // ---------------------------------------------------------------------------

  describe('diferença e variação', () => {
    it('reproduz o exemplo: 25 kg previstos, 27 kg consumidos', () => {
      // 100 pizzas × 250 g = 25.000 g previstos; o razão acusou 27.000 g.
      const result = compare('25000', '27000');

      expect(result.difference.toString()).toBe('2000');
      expect(result.variationPercent.toString()).toBe('8');
      expect(result.classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });

    it('trata consumo abaixo do previsto como diferença negativa', () => {
      const result = compare('25000', '23000');

      expect(result.difference.toString()).toBe('-2000');
      expect(result.variationPercent.toString()).toBe('-8');
      expect(result.classification).toBe(
        ConsumptionClassification.ABAIXO_DO_ESPERADO,
      );
    });

    it('devolve diferença zero quando estimado e real batem', () => {
      const result = compare('25000', '25000');

      expect(result.difference.isZero()).toBe(true);
      expect(result.variationPercent.toString()).toBe('0');
      expect(result.classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('não perde precisão em quantidades decimais', () => {
      const result = compare('0.333333', '0.333334');

      expect(result.difference.toString()).toBe('0.000001');
    });
  });

  // ---------------------------------------------------------------------------

  describe('base zero', () => {
    /**
     * Insumo que saiu do estoque sem nenhuma venda prevendo. É o caso que mais
     * importa e o que uma divisão ingênua transformaria em NaN ou em zero.
     */
    it('não inventa porcentagem quando o estimado é zero', () => {
      const result = compare('0', '500');

      expect(result.variationPercent).toBeNull();
      expect(result.difference.toString()).toBe('500');
      expect(result.classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });

    it('classifica como dentro da tolerância quando os dois lados são zero', () => {
      const result = compare('0', '0');

      expect(result.variationPercent).toBeNull();
      expect(result.classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('acusa consumo negativo sem estimativa como abaixo do esperado', () => {
      // Ajuste de inventário que devolveu saldo sem venda correspondente.
      const result = compare('0', '-300');

      expect(result.variationPercent).toBeNull();
      expect(result.classification).toBe(
        ConsumptionClassification.ABAIXO_DO_ESPERADO,
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('tolerância', () => {
    it('absorve o desvio exatamente igual à tolerância', () => {
      // 5% de 1000 é 50: o limite conta como dentro, não como fora.
      expect(compare('1000', '1050').classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('acusa um centésimo acima do limite', () => {
      expect(compare('1000', '1050.2').classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
    });

    it('aplica a tolerância nos dois sentidos', () => {
      // 940 é −6% (fora); 970 é −3% (dentro). A mesma margem vale para falta
      // e para sobra.
      expect(compare('1000', '940').classification).toBe(
        ConsumptionClassification.ABAIXO_DO_ESPERADO,
      );
      expect(compare('1000', '970').classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    /**
     * Regressão: a classificação usa a porcentagem cheia. Arredondar antes de
     * comparar fazia 0,0001% virar 0,00% e passar como dentro da tolerância
     * mesmo com a tolerância zerada.
     */
    it('com tolerância zero, qualquer diferença é desvio', () => {
      expect(compare('1000', '1000.001', '0', '0').classification).toBe(
        ConsumptionClassification.ACIMA_DO_ESPERADO,
      );
      expect(compare('1000', '1000', '0', '0').classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });

    it('uma tolerância larga engole desvios grandes', () => {
      expect(compare('1000', '1400', '0', '50').classification).toBe(
        ConsumptionClassification.DENTRO_DA_TOLERANCIA,
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('custo financeiro do desvio', () => {
    it('reproduz o exemplo: 2 kg a R$ 28/kg custam R$ 56', () => {
      // O estoque é guardado em grama, então R$ 28/kg é R$ 0,028/g.
      const result = compare('25000', '27000', '0.028');

      expect(result.differenceCost.toString()).toBe('56');
      expect(result.estimatedCost.toString()).toBe('700');
      expect(result.realCost.toString()).toBe('756');
    });

    it('devolve custo negativo quando se consumiu menos que o previsto', () => {
      expect(compare('25000', '23000', '0.028').differenceCost.toString()).toBe(
        '-56',
      );
    });

    it('mantém o custo em zero para insumo nunca comprado', () => {
      // Custo desconhecido vale zero: melhor um desvio sem valor do que um
      // valor inventado que entraria no total do painel.
      const result = compare('25000', '27000', '0');

      expect(result.differenceCost.isZero()).toBe(true);
      expect(result.difference.toString()).toBe('2000');
    });
  });

  // ---------------------------------------------------------------------------

  describe('decomposição do desvio', () => {
    it('atribui todo o desvio a uma perda já registrada', () => {
      // 2.000 g de desvio explicados por 2.000 g de perda lançada: não sobra
      // nada de desperdício não identificado.
      const result = service.explainDeviation(new Prisma.Decimal(2000), {
        [StockMovementType.SALE]: new Prisma.Decimal(25000),
        [StockMovementType.LOSS]: new Prisma.Decimal(2000),
      });

      expect(result.documented.toString()).toBe('2000');
      expect(result.undocumented.toString()).toBe('0');
    });

    it('separa a parte sem documento quando a venda consumiu menos que a ficha', () => {
      // Desvio de 2.000 com apenas 500 de perda lançada: 1.500 vieram da
      // própria venda, tipicamente prato vendido sem ficha ativa.
      const result = service.explainDeviation(new Prisma.Decimal(2000), {
        [StockMovementType.LOSS]: new Prisma.Decimal(500),
      });

      expect(result.documented.toString()).toBe('500');
      expect(result.undocumented.toString()).toBe('1500');
    });

    it('soma perda, ajuste, produção e transferência como documentados', () => {
      const result = service.explainDeviation(new Prisma.Decimal(1000), {
        [StockMovementType.LOSS]: new Prisma.Decimal(100),
        [StockMovementType.ADJUSTMENT]: new Prisma.Decimal(200),
        [StockMovementType.PRODUCTION]: new Prisma.Decimal(300),
        [StockMovementType.TRANSFER]: new Prisma.Decimal(400),
      });

      expect(result.documented.toString()).toBe('1000');
      expect(result.undocumented.toString()).toBe('0');
    });

    it('não conta a própria venda como documento do desvio', () => {
      // SALE é o lado que o estimado já explica; contá-lo aqui zeraria todo
      // desvio por construção.
      const result = service.explainDeviation(new Prisma.Decimal(2000), {
        [StockMovementType.SALE]: new Prisma.Decimal(25000),
      });

      expect(result.documented.isZero()).toBe(true);
      expect(result.undocumented.toString()).toBe('2000');
    });
  });

  // ---------------------------------------------------------------------------

  describe('ordenação por gravidade', () => {
    it('coloca consumo sem estimativa na frente de qualquer porcentagem', () => {
      const rows = [
        { name: 'a', variationPercent: new Prisma.Decimal(400) },
        { name: 'b', variationPercent: null },
        { name: 'c', variationPercent: new Prisma.Decimal(-900) },
      ];

      expect(
        rows.sort((a, b) => service.bySeverity(a, b)).map((row) => row.name),
      ).toEqual(['b', 'c', 'a']);
    });

    it('ordena por módulo, para sobra e falta disputarem a mesma lista', () => {
      const rows = [
        { name: 'a', variationPercent: new Prisma.Decimal(10) },
        { name: 'b', variationPercent: new Prisma.Decimal(-30) },
        { name: 'c', variationPercent: new Prisma.Decimal(20) },
      ];

      expect(
        rows.sort((a, b) => service.bySeverity(a, b)).map((row) => row.name),
      ).toEqual(['b', 'c', 'a']);
    });
  });

  // ---------------------------------------------------------------------------

  describe('percentual de desperdício', () => {
    it('mede o desvio contra o custo previsto', () => {
      expect(
        service
          .wastePercent(new Prisma.Decimal(700), new Prisma.Decimal(56))
          .toString(),
      ).toBe('8');
    });

    it('é nulo quando não houve consumo previsto', () => {
      expect(
        service.wastePercent(new Prisma.Decimal(0), new Prisma.Decimal(56)),
      ).toBeNull();
    });
  });
});
