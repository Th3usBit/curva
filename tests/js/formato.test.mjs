import { test } from "node:test";
import assert from "node:assert/strict";
import * as F from "../../site/js/formato.js";
import { ticks } from "../../site/js/grafico.js";

// Intl usa espaco nao separavel entre "R$" e o numero.
const limpo = (s) => s.replace(/\s/g, " ");

test("moeda e porcentagem no formato brasileiro", () => {
  assert.equal(limpo(F.brl(1234.5)), "R$ 1.234,50");
  assert.equal(F.pct(0.1234), "12,34%");
  assert.equal(F.pct(-0.0996), "−9,96%");
  assert.equal(F.pctSinal(-0.0444), "−4,44%");
  assert.equal(F.pctSinal(0.05, 1), "+5,0%");
  assert.equal(F.taxa(13.37), "13,37%");
  assert.equal(F.pp(0.01), "+1,00 p.p.");
  assert.equal(F.brl(NaN), "—");
});

test("datas", () => {
  assert.equal(F.data("2026-10-02"), "02/10/2026");
  assert.equal(F.mesAno("2028-10-05"), "out/2028");
});

test("prazos legiveis", () => {
  assert.equal(F.prazo(0.25), "3 meses");
  assert.equal(F.prazo(5.2), "5,2 anos");
  assert.equal(F.meses(18), "1 ano e 6 meses");
  assert.equal(F.meses(24), "2 anos");
  assert.equal(F.meses(1), "1 mês");
});

test("ticks redondos cobrindo o intervalo", () => {
  assert.deepEqual(ticks(0, 10, 5), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(ticks(13.1, 14.6, 4), [13.5, 14, 14.5]);
  assert.deepEqual(ticks(5, 5), [5]);
});
