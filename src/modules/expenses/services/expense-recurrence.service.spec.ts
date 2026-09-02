import { BadRequestException } from '@nestjs/common';
import { AllocationPeriod, ExpenseRecurrence } from '@prisma/client';

import {
  ExpenseRecurrenceService,
  ExpenseRule,
} from './expense-recurrence.service';

describe('ExpenseRecurrenceService', () => {
  const service = new ExpenseRecurrenceService();

  const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  const rule = (overrides: Partial<ExpenseRule> = {}): ExpenseRule => ({
    amount: '5000',
    recurrence: ExpenseRecurrence.MONTHLY,
    startDate: utc('2026-01-01'),
    endDate: null,
    active: true,
    deactivatedAt: null,
    ...overrides,
  });

  const datesOf = (r: ExpenseRule, from: string, to: string) =>
    service
      .expand(r, { from: utc(from), to: utc(to) })
      .map((occurrence) => occurrence.competenceDate.toISOString().slice(0, 10));

  // ---------------------------------------------------------------------------

  describe('ONCE', () => {
    it('gera uma competência na data da despesa', () => {
      const avulsa = rule({
        recurrence: ExpenseRecurrence.ONCE,
        startDate: utc('2026-03-14'),
      });

      expect(datesOf(avulsa, '2026-03-01', '2026-03-31')).toEqual([
        '2026-03-14',
      ]);
    });

    it('não aparece fora da janela', () => {
      const avulsa = rule({
        recurrence: ExpenseRecurrence.ONCE,
        startDate: utc('2026-03-14'),
      });

      expect(datesOf(avulsa, '2026-04-01', '2026-04-30')).toEqual([]);
    });

    it('não se repete mesmo com data final distante', () => {
      const avulsa = rule({
        recurrence: ExpenseRecurrence.ONCE,
        startDate: utc('2026-03-14'),
        endDate: utc('2026-12-31'),
      });

      expect(datesOf(avulsa, '2026-01-01', '2026-12-31')).toEqual([
        '2026-03-14',
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('DAILY', () => {
    it('gera uma competência por dia', () => {
      const diaria = rule({
        recurrence: ExpenseRecurrence.DAILY,
        startDate: utc('2026-03-01'),
      });

      expect(datesOf(diaria, '2026-03-01', '2026-03-05')).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
      ]);
    });

    it('atravessa a virada de mês sem pular dia', () => {
      const diaria = rule({
        recurrence: ExpenseRecurrence.DAILY,
        startDate: utc('2026-02-26'),
      });

      expect(datesOf(diaria, '2026-02-27', '2026-03-02')).toEqual([
        '2026-02-27',
        '2026-02-28',
        '2026-03-01',
        '2026-03-02',
      ]);
    });

    /**
     * A despesa começou anos antes da janela. Iterar desde o início percorreria
     * milhares de dias antes da primeira linha útil, então o cálculo salta
     * direto para o primeiro índice dentro da janela.
     */
    it('salta para dentro da janela quando o início é antigo', () => {
      const diaria = rule({
        recurrence: ExpenseRecurrence.DAILY,
        startDate: utc('2020-01-01'),
      });

      expect(datesOf(diaria, '2026-03-01', '2026-03-03')).toEqual([
        '2026-03-01',
        '2026-03-02',
        '2026-03-03',
      ]);
    });

    it('recusa uma janela grande demais para expandir', () => {
      const diaria = rule({
        recurrence: ExpenseRecurrence.DAILY,
        startDate: utc('1990-01-01'),
      });

      expect(() =>
        datesOf(diaria, '1990-01-01', '2090-01-01'),
      ).toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------

  describe('WEEKLY', () => {
    it('repete a cada sete dias a partir do início', () => {
      const semanal = rule({
        recurrence: ExpenseRecurrence.WEEKLY,
        startDate: utc('2026-03-02'),
      });

      expect(datesOf(semanal, '2026-03-01', '2026-03-31')).toEqual([
        '2026-03-02',
        '2026-03-09',
        '2026-03-16',
        '2026-03-23',
        '2026-03-30',
      ]);
    });

    it('mantém o dia da semana ao entrar por uma janela posterior', () => {
      const semanal = rule({
        recurrence: ExpenseRecurrence.WEEKLY,
        startDate: utc('2026-01-05'),
      });

      // 05/01 é segunda; todas as competências caem em segunda.
      expect(datesOf(semanal, '2026-03-01', '2026-03-15')).toEqual([
        '2026-03-02',
        '2026-03-09',
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('MONTHLY', () => {
    it('repete todo mês no mesmo dia', () => {
      expect(datesOf(rule(), '2026-01-01', '2026-04-30')).toEqual([
        '2026-01-01',
        '2026-02-01',
        '2026-03-01',
        '2026-04-01',
      ]);
    });

    /**
     * O caso que quebra soma ingênua de mês: 31 de janeiro + 1 mês daria 3 de
     * março, e o erro se acumularia para sempre. A competência precisa ser
     * aparada ao último dia do mês curto e VOLTAR ao dia 31 no mês seguinte.
     */
    it('apara o dia 31 nos meses curtos sem arrastar os seguintes', () => {
      const aluguel = rule({ startDate: utc('2026-01-31') });

      expect(datesOf(aluguel, '2026-01-01', '2026-05-31')).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
      ]);
    });

    it('usa 29 de fevereiro em ano bissexto', () => {
      const aluguel = rule({ startDate: utc('2027-12-31') });

      // 2028 é bissexto: fevereiro tem 29 dias.
      expect(datesOf(aluguel, '2028-02-01', '2028-02-29')).toEqual([
        '2028-02-29',
      ]);
    });

    it('não gera competência antes do início', () => {
      const aluguel = rule({ startDate: utc('2026-03-01') });

      expect(datesOf(aluguel, '2026-01-01', '2026-04-30')).toEqual([
        '2026-03-01',
        '2026-04-01',
      ]);
    });

    it('entra corretamente numa janela muito posterior ao início', () => {
      const aluguel = rule({ startDate: utc('2020-01-15') });

      expect(datesOf(aluguel, '2026-03-01', '2026-04-30')).toEqual([
        '2026-03-15',
        '2026-04-15',
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('YEARLY', () => {
    it('repete uma vez por ano', () => {
      const anual = rule({
        recurrence: ExpenseRecurrence.YEARLY,
        startDate: utc('2026-07-10'),
      });

      expect(datesOf(anual, '2026-01-01', '2029-12-31')).toEqual([
        '2026-07-10',
        '2027-07-10',
        '2028-07-10',
        '2029-07-10',
      ]);
    });

    it('apara 29 de fevereiro nos anos comuns', () => {
      const anual = rule({
        recurrence: ExpenseRecurrence.YEARLY,
        startDate: utc('2028-02-29'),
      });

      expect(datesOf(anual, '2028-01-01', '2030-12-31')).toEqual([
        '2028-02-29',
        '2029-02-28',
        '2030-02-28',
      ]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('fim de vigência', () => {
    it('para na data final', () => {
      const aluguel = rule({ endDate: utc('2026-03-01') });

      expect(datesOf(aluguel, '2026-01-01', '2026-06-30')).toEqual([
        '2026-01-01',
        '2026-02-01',
        '2026-03-01',
      ]);
    });

    /**
     * O ponto do `deactivatedAt`: desativar o aluguel em março não pode zerar
     * o custo de janeiro. Desativar para de repetir daqui pra frente.
     */
    it('desativar preserva as competências já passadas', () => {
      const aluguel = rule({
        active: false,
        deactivatedAt: new Date('2026-03-10T14:30:00.000Z'),
      });

      expect(datesOf(aluguel, '2026-01-01', '2026-06-30')).toEqual([
        '2026-01-01',
        '2026-02-01',
        '2026-03-01',
      ]);
    });

    it('vale a mais cedo entre data final e desativação', () => {
      const aluguel = rule({
        active: false,
        endDate: utc('2026-05-01'),
        deactivatedAt: new Date('2026-02-20T00:00:00.000Z'),
      });

      expect(datesOf(aluguel, '2026-01-01', '2026-06-30')).toEqual([
        '2026-01-01',
        '2026-02-01',
      ]);
    });

    it('inativa sem nenhuma data de corte não produz competência', () => {
      // Trava defensiva: sem saber quando parou, não afirma que rodou.
      const aluguel = rule({ active: false });

      expect(datesOf(aluguel, '2026-01-01', '2026-06-30')).toEqual([]);
    });

    it('data final anterior ao início não produz nada', () => {
      const aluguel = rule({
        startDate: utc('2026-05-01'),
        endDate: utc('2026-03-01'),
      });

      expect(datesOf(aluguel, '2026-01-01', '2026-12-31')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------

  describe('janela', () => {
    it('é inclusiva nas duas pontas', () => {
      const aluguel = rule({ startDate: utc('2026-03-01') });

      expect(datesOf(aluguel, '2026-03-01', '2026-03-01')).toEqual([
        '2026-03-01',
      ]);
    });

    it('inclui a competência do último dia do mês', () => {
      const aluguel = rule({ startDate: utc('2026-01-31') });

      expect(datesOf(aluguel, '2026-03-01', '2026-03-31')).toEqual([
        '2026-03-31',
      ]);
    });

    it('recusa janela invertida', () => {
      expect(() => datesOf(rule(), '2026-03-31', '2026-03-01')).toThrow(
        BadRequestException,
      );
    });

    it('ignora a hora do dia ao recortar', () => {
      const aluguel = rule({ startDate: utc('2026-03-15') });

      const occurrences = service.expand(aluguel, {
        from: new Date('2026-03-15T23:59:00.000Z'),
        to: new Date('2026-03-15T00:01:00.000Z'),
      });

      expect(occurrences).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------------

  describe('valor', () => {
    it('repete o mesmo valor em cada competência', () => {
      const occurrences = service.expand(rule({ amount: '5000' }), {
        from: utc('2026-01-01'),
        to: utc('2026-03-31'),
      });

      expect(occurrences).toHaveLength(3);
      expect(
        occurrences.every((o) => o.amount.toString() === '5000'),
      ).toBe(true);
    });

    it('preserva centavos sem virar float', () => {
      const occurrences = service.expand(rule({ amount: '833.33' }), {
        from: utc('2026-01-01'),
        to: utc('2026-01-31'),
      });

      expect(occurrences[0].amount.toString()).toBe('833.33');
    });
  });

  // ---------------------------------------------------------------------------

  describe('períodos de referência na janela', () => {
    const periods = (from: string, to: string, period: AllocationPeriod) =>
      service.referencePeriodsIn({ from: utc(from), to: utc(to) }, period);

    it('conta um mês para uma janela dentro do mês', () => {
      expect(periods('2026-03-01', '2026-03-31', AllocationPeriod.MONTHLY)).toBe(
        1,
      );
      expect(periods('2026-03-10', '2026-03-20', AllocationPeriod.MONTHLY)).toBe(
        1,
      );
    });

    it('conta três meses num trimestre', () => {
      expect(periods('2026-01-01', '2026-03-31', AllocationPeriod.MONTHLY)).toBe(
        3,
      );
    });

    it('conta meses tocados, mesmo parcialmente', () => {
      expect(periods('2026-01-25', '2026-03-02', AllocationPeriod.MONTHLY)).toBe(
        3,
      );
    });

    it('conta dias', () => {
      expect(periods('2026-03-01', '2026-03-05', AllocationPeriod.DAILY)).toBe(
        5,
      );
      expect(periods('2026-03-01', '2026-03-01', AllocationPeriod.DAILY)).toBe(
        1,
      );
    });

    it('conta semanas pelas segundas-feiras tocadas', () => {
      // 02/03/2026 e 09/03/2026 são segundas: duas semanas.
      expect(periods('2026-03-02', '2026-03-09', AllocationPeriod.WEEKLY)).toBe(
        2,
      );
      expect(periods('2026-03-02', '2026-03-08', AllocationPeriod.WEEKLY)).toBe(
        1,
      );
    });

    it('conta anos', () => {
      expect(periods('2026-06-01', '2028-02-01', AllocationPeriod.YEARLY)).toBe(
        3,
      );
    });
  });

  // ---------------------------------------------------------------------------

  describe('janela do mês', () => {
    it('vai do primeiro ao último dia', () => {
      const window = service.monthWindow(new Date('2026-02-17T10:00:00.000Z'));

      expect(window.from.toISOString().slice(0, 10)).toBe('2026-02-01');
      expect(window.to.toISOString().slice(0, 10)).toBe('2026-02-28');
    });

    it('acerta o último dia em ano bissexto', () => {
      const window = service.monthWindow(new Date('2028-02-17T10:00:00.000Z'));

      expect(window.to.toISOString().slice(0, 10)).toBe('2028-02-29');
    });
  });
});
