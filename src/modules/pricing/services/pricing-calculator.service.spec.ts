import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  PricingCalculatorService,
  PricingPercentages,
  RoundingStrategy,
  UnreachablePriceException,
} from './pricing-calculator.service';

describe('PricingCalculatorService', () => {
  const service = new PricingCalculatorService();

  const percentages = (
    overrides: Partial<Record<keyof PricingPercentages, string | number>> = {},
  ): PricingPercentages => ({
    marginPercent: new Prisma.Decimal(overrides.marginPercent ?? 30),
    taxPercent: new Prisma.Decimal(overrides.taxPercent ?? 6),
    cardFeePercent: new Prisma.Decimal(overrides.cardFeePercent ?? 5),
    deliveryFeePercent: new Prisma.Decimal(overrides.deliveryFeePercent ?? 0),
    otherFeesPercent: new Prisma.Decimal(overrides.otherFeesPercent ?? 0),
  });

  const price = (
    cost: string,
    overrides: Partial<Record<keyof PricingPercentages, string | number>> = {},
  ) => service.recommendedPrice(cost, percentages(overrides)).toString();

  // ---------------------------------------------------------------------------

  describe('a fórmula do enunciado', () => {
    it('R$ 7,40 com 6% de imposto, 5% de taxa e 30% de margem dá R$ 12,54', () => {
      // 7,40 / (1 − 0,06 − 0,05 − 0,30) = 7,40 / 0,59
      expect(price('7.40')).toBe('12.54');
    });

    it('reparte o divisor entre as taxas, não importa de onde elas venham', () => {
      // Os mesmos 5% divididos entre cartão, delivery e outras.
      const espalhado = price('7.40', {
        cardFeePercent: 2,
        deliveryFeePercent: 2,
        otherFeesPercent: 1,
      });

      expect(espalhado).toBe('12.54');
    });

    /**
     * O erro clássico da precificação. Somar 30% ao custo entrega uma margem
     * real bem menor, porque imposto e taxa ainda vão sair do preço final.
     */
    it('não é o custo mais a margem — essa conta daria bem menos', () => {
      const somaIngenua = new Prisma.Decimal('7.40').mul('1.30');

      expect(somaIngenua.toFixed(2)).toBe('9.62');
      expect(price('7.40')).toBe('12.54');

      // E a margem real do preço ingênuo fica longe dos 30% pedidos.
      const real = service.breakdown('9.62', '7.40', percentages());
      expect(Number(real.marginPercent)).toBeLessThan(15);
    });
  });

  // ---------------------------------------------------------------------------

  describe('variações de margem', () => {
    /**
     * Custo R$ 7,40, imposto 6%, taxa 5% — os mesmos números do enunciado.
     *
     * A tabela ilustrativa do enunciado traz 13,29 / 14,23 / 15,47 nas três
     * últimas linhas, que NÃO saem da fórmula que ele mesmo define: elas
     * implicam totais de 44,32%, 48% e 52,17% onde deveriam ser 46%, 51% e 56%.
     * Só a primeira linha (12,54) fecha. Vale a fórmula, que é explícita e tem
     * o exemplo detalhado batendo ao centavo.
     */
    it('reproduz a tabela do simulador pela fórmula', () => {
      expect(price('7.40', { marginPercent: 30 })).toBe('12.54'); // /0,59
      expect(price('7.40', { marginPercent: 35 })).toBe('13.7'); // /0,54
      expect(price('7.40', { marginPercent: 40 })).toBe('15.1'); // /0,49
      expect(price('7.40', { marginPercent: 45 })).toBe('16.82'); // /0,44
    });

    /**
     * A prova de que a fórmula está certa: cobrar o preço calculado entrega a
     * margem pedida.
     *
     * A folga de 0,15 ponto é o arredondamento ao centavo — do preço e das
     * linhas de imposto e taxa. Fechar essa fresta exigiria não arredondar as
     * parcelas, e aí elas deixariam de somar o preço, que é uma propriedade
     * mais útil num demonstrativo do que uma margem redonda.
     */
    it('a margem obtida em cada linha bate com a margem pedida', () => {
      for (const margem of [30, 35, 40, 45]) {
        const preco = price('7.40', { marginPercent: margem });
        const percentuais = percentages({ marginPercent: margem });
        const detalhe = service.breakdown(preco, '7.40', percentuais);

        expect(
          Math.abs(Number(detalhe.marginPercent) - margem),
        ).toBeLessThan(0.15);

        // E as parcelas continuam somando o preço, em toda linha.
        expect(
          detalhe.cost
            .add(detalhe.taxes)
            .add(detalhe.fees)
            .add(detalhe.profit)
            .toString(),
        ).toBe(detalhe.price.toString());
      }
    });

    it('margem zero cobre só custo, imposto e taxa', () => {
      const semMargem = price('7.40', { marginPercent: 0 });

      expect(semMargem).toBe('8.31');

      const detalhe = service.breakdown(semMargem, '7.40', {
        ...percentages({ marginPercent: 0 }),
      });
      expect(Number(detalhe.profit)).toBeCloseTo(0, 1);
    });

    it('quanto maior a margem, maior o preço', () => {
      const precos = [10, 20, 30, 40, 50].map((margem) =>
        Number(price('7.40', { marginPercent: margem })),
      );

      for (let i = 1; i < precos.length; i += 1) {
        expect(precos[i]).toBeGreaterThan(precos[i - 1]);
      }
    });

    it('sobe de forma acelerada perto do limite', () => {
      // O divisor tende a zero: a diferença de 85% para 90% é muito maior que
      // a de 10% para 15%.
      const baixa =
        Number(price('7.40', { marginPercent: 15 })) -
        Number(price('7.40', { marginPercent: 10 }));
      const alta =
        Number(price('7.40', { marginPercent: 88 })) -
        Number(price('7.40', { marginPercent: 83 }));

      expect(alta).toBeGreaterThan(baixa * 10);
    });
  });

  // ---------------------------------------------------------------------------

  describe('variações de custo, imposto e taxa', () => {
    it('o preço é proporcional ao custo', () => {
      expect(price('14.80')).toBe('25.08');
      expect(price('3.70')).toBe('6.27');
    });

    it('custo zero dá preço zero', () => {
      expect(price('0')).toBe('0');
    });

    it('sem imposto e sem taxa, o divisor é só a margem', () => {
      // 7,40 / 0,70
      expect(
        price('7.40', { taxPercent: 0, cardFeePercent: 0, marginPercent: 30 }),
      ).toBe('10.57');
    });

    it('imposto maior empurra o preço para cima', () => {
      const comum = Number(price('7.40', { taxPercent: 6 }));
      const pesado = Number(price('7.40', { taxPercent: 18 }));

      expect(pesado).toBeGreaterThan(comum);
    });

    it('cartão e delivery somados precificam o canal mais caro', () => {
      const balcao = price('7.40', {
        cardFeePercent: 0,
        deliveryFeePercent: 0,
      });
      const delivery = price('7.40', {
        cardFeePercent: 5,
        deliveryFeePercent: 12,
      });

      expect(Number(delivery)).toBeGreaterThan(Number(balcao));
    });

    it('preserva centavos sem virar float', () => {
      expect(price('0.01', { taxPercent: 0, cardFeePercent: 0 })).toBe('0.01');
      expect(price('1234.56')).toBe('2092.47');
    });
  });

  // ---------------------------------------------------------------------------

  describe('valores inválidos', () => {
    it('recusa a soma de exatamente 100%', () => {
      // O divisor seria zero: nenhuma divisão possível.
      expect(() =>
        price('7.40', {
          marginPercent: 89,
          taxPercent: 6,
          cardFeePercent: 5,
        }),
      ).toThrow(UnreachablePriceException);
    });

    it('recusa a soma acima de 100%', () => {
      // Sem a trava, o divisor negativo devolveria um preço NEGATIVO.
      expect(() => price('7.40', { marginPercent: 95 })).toThrow(
        UnreachablePriceException,
      );
    });

    it('a mensagem diz que não é possível calcular o preço', () => {
      expect(() => price('7.40', { marginPercent: 95 })).toThrow(
        /Não é possível calcular o preço/,
      );
    });

    it('aceita 99,99% — o limite é o 100, não a proximidade dele', () => {
      expect(() =>
        price('7.40', {
          marginPercent: 88.99,
          taxPercent: 6,
          cardFeePercent: 5,
        }),
      ).not.toThrow();
    });

    it('recusa percentual negativo', () => {
      expect(() => price('7.40', { marginPercent: -10 })).toThrow(
        BadRequestException,
      );
      expect(() => price('7.40', { taxPercent: -1 })).toThrow(
        BadRequestException,
      );
    });

    it('recusa custo negativo', () => {
      expect(() => price('-1')).toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('rentabilidade', () => {
    it('abre o preço recomendado em custo, imposto, taxa e lucro', () => {
      const detalhe = service.breakdown('12.54', '7.40', percentages());

      expect(detalhe.cost.toString()).toBe('7.4');
      expect(detalhe.taxes.toString()).toBe('0.75'); // 6% de 12,54
      expect(detalhe.fees.toString()).toBe('0.63'); // 5% de 12,54
      expect(detalhe.profit.toString()).toBe('3.76');
    });

    it('as partes somam o preço', () => {
      const detalhe = service.breakdown('12.54', '7.40', percentages());
      const soma = detalhe.cost
        .add(detalhe.taxes)
        .add(detalhe.fees)
        .add(detalhe.profit);

      expect(soma.toString()).toBe('12.54');
    });

    /**
     * A margem sai do preço REAL, não do desejado. Depois de arredondar
     * 12,5423 para 12,54 ela já não é exatamente 30%, e repetir os 30% pedidos
     * seria mostrar a intenção no lugar do resultado.
     */
    it('devolve a margem obtida, não a pedida', () => {
      const detalhe = service.breakdown('12.54', '7.40', percentages());

      expect(detalhe.marginPercent.toString()).toBe('29.98');
    });

    it('separa margem sobre o preço de markup sobre o custo', () => {
      const detalhe = service.breakdown('12.54', '7.40', percentages());

      // 3,76 / 12,54 contra (12,54 − 7,40) / 7,40: perguntas diferentes.
      expect(detalhe.marginPercent.toString()).toBe('29.98');
      expect(detalhe.markupOverCostPercent.toString()).toBe('69.46');
    });

    it('acusa prejuízo quando o preço não cobre custo e encargos', () => {
      const detalhe = service.breakdown('7.00', '7.40', percentages());

      expect(detalhe.profit.isNegative()).toBe(true);
      expect(detalhe.marginPercent.isNegative()).toBe(true);
    });

    it('mede a margem do preço atual do enunciado', () => {
      // Preço praticado de R$ 11,90 contra o recomendado de R$ 12,54.
      const detalhe = service.breakdown('11.90', '7.40', percentages());

      expect(detalhe.profit.toString()).toBe('3.19');
      expect(detalhe.marginPercent.toString()).toBe('26.81');
    });
  });

  // ---------------------------------------------------------------------------

  describe('arredondamento', () => {
    const suggestions = (recommended: string, cost = '7.40') =>
      service.roundingSuggestions(
        new Prisma.Decimal(recommended),
        cost,
        percentages(),
      );

    it('sugere R$ 12,50, R$ 12,90 e R$ 13,00 para R$ 12,54', () => {
      const precos = suggestions('12.54').map((item) => item.price.toString());

      expect(precos).toContain('12.5');
      expect(precos).toContain('12.9');
      expect(precos).toContain('13');
    });

    it('vem ordenado do menor para o maior', () => {
      const precos = suggestions('12.54').map((item) => Number(item.price));

      expect([...precos].sort((a, b) => a - b)).toEqual(precos);
    });

    /**
     * O ponto das sugestões: arredondar para baixo come margem. Sem o número
     * ao lado, a escolha vira estética.
     */
    it('cada sugestão traz a margem que ela realmente entrega', () => {
      const lista = suggestions('12.54');
      const abaixo = lista.find((item) => item.price.toString() === '12.5');
      const acima = lista.find((item) => item.price.toString() === '13');

      expect(Number(abaixo.marginPercent)).toBeLessThan(29.98);
      expect(Number(acima.marginPercent)).toBeGreaterThan(29.98);
      expect(Number(abaixo.differenceFromRecommended)).toBeLessThan(0);
      expect(Number(acima.differenceFromRecommended)).toBeGreaterThan(0);
    });

    it('escolhe a terminação mais próxima, acima ou abaixo', () => {
      // 12,95 está mais perto de 12,90 do que de 13,90.
      const noventa = suggestions('12.95').find(
        (item) => item.strategy === RoundingStrategy.ENDING_90,
      );

      expect(noventa.price.toString()).toBe('12.9');
    });

    it('não repete o mesmo preço em duas estratégias', () => {
      // 12,90 recomendado: a dezena de centavo e a terminação ,90 coincidem.
      const precos = suggestions('12.90').map((item) => item.price.toString());

      expect(new Set(precos).size).toBe(precos.length);
    });

    it('nunca sugere preço negativo ou zero', () => {
      const precos = suggestions('0.40', '0.20').map((item) =>
        Number(item.price),
      );

      expect(precos.every((valor) => valor > 0)).toBe(true);
    });

    it('arredonda para o real cheio acima, nunca abaixo', () => {
      const cheio = suggestions('12.01').find(
        (item) => item.strategy === RoundingStrategy.WHOLE_UP,
      );

      expect(cheio.price.toString()).toBe('13');
    });
  });

  // ---------------------------------------------------------------------------

  describe('soma dos percentuais', () => {
    it('junta cartão, delivery e outras taxas', () => {
      expect(
        service
          .feesPercent(
            percentages({
              cardFeePercent: 3,
              deliveryFeePercent: 12,
              otherFeesPercent: 1.5,
            }),
          )
          .toString(),
      ).toBe('16.5');
    });

    it('o total inclui imposto e margem', () => {
      expect(service.totalPercent(percentages()).toString()).toBe('41');
    });
  });
});
