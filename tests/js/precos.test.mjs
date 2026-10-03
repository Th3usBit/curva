// A conta do navegador contra os precos oficiais de 02/10/2026 (fixture gerada
// pelo Python a partir da amostra do arquivo do Tesouro).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as P from "../../site/js/precos.js";

const resumo = JSON.parse(readFileSync(new URL("../fixtures/resumo.json", import.meta.url), "utf8"));
const titulo = (id) => resumo.titulos.find((t) => t.id === id);
const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b} (tol ${tol})`);

test("o PU publicado sai dos fluxos em todos os titulos a venda", () => {
  for (const t of resumo.titulos.filter((x) => x.a_venda)) {
    const pu = t.base * P.cotacao(t.fluxos, t.taxa_compra / 100);
    perto(pu, t.pu_compra, 0.011, t.id);
  }
});

test("prefixados: base de R$ 1.000 e preco ao centavo, sem nada calibrado", () => {
  for (const t of resumo.titulos.filter((x) => x.indexador === "pre")) {
    assert.equal(t.base, 1000);
    perto(1000 * P.cotacao(t.fluxos, t.taxa_compra / 100), t.pu_compra, 0.011, t.id);
  }
});

test("duration igual a do Python", () => {
  for (const t of resumo.titulos.filter((x) => x.a_venda)) {
    perto(P.duration(t.fluxos, t.taxa_compra / 100), t.duration, 1e-3, t.id);
  }
});

test("sensibilidade: preco cai quando a taxa sobe, mais nos titulos longos", () => {
  const curto = titulo("prefixado-2027-01-01"), longo = titulo("prefixado-2032-01-01");
  const sCurto = P.sensibilidade(curto.fluxos, curto.taxa_compra / 100, 0.01);
  const sLongo = P.sensibilidade(longo.fluxos, longo.taxa_compra / 100, 0.01);
  assert.ok(sCurto < 0 && sLongo < sCurto);
  // Aproximacao pela duration modificada: -D/(1+i) por ponto.
  perto(sLongo, -longo.duration / (1 + longo.taxa_compra / 100) * 0.01, 0.003);
});

test("interpolar e plano nas pontas e linear no meio", () => {
  const pts = [[100, 0.10], [300, 0.14]];
  assert.equal(P.interpolar(pts, 50), 0.10);
  assert.equal(P.interpolar(pts, 400), 0.14);
  perto(P.interpolar(pts, 200), 0.12, 1e-12);
});

test("inflacao implicita de 5 anos fica entre 2% e 12%", () => {
  const z = P.curvasZero(resumo.titulos);
  assert.ok(z.pre.length >= 3 && z.real.length >= 3);
  const inf = P.inflacaoImplicita(z, 5 * 252);
  assert.ok(inf > 0.02 && inf < 0.12, String(inf));
});

test("du_mes cresce e da ~252 por ano", () => {
  const d = resumo.du_mes;
  for (let i = 1; i < d.length; i++) assert.ok(d[i] >= d[i - 1]);
  perto(d[120] / 10, 252, 4);
});

const OP = { valor: 10000, meses: 24, choque: 0, inflacao: 0.045, selic: 0.13 };

test("simular: vender hoje sem choque devolve o valor menos o spread do Tesouro", () => {
  for (const t of resumo.titulos.filter((x) => x.a_venda)) {
    const r = P.simular(t, resumo.du_mes, { ...OP, meses: 0 });
    // Compra pelo PU oficial, venda pelo PU recalculado na taxa de venda.
    const esperado = OP.valor / t.pu_compra * t.base * P.cotacao(t.fluxos, t.taxa_venda / 100);
    perto(r.total, esperado, 1e-3, t.id);   // milesimo de real
    assert.ok(r.total <= OP.valor + 1e-9, t.id);
  }
});

test("simular: juros maiores, valor menor na venda", () => {
  const t = titulo("ipca-2045-05-15");
  const sobe = P.simular(t, resumo.du_mes, { ...OP, choque: 0.01 }).total;
  const fica = P.simular(t, resumo.du_mes, OP).total;
  const cai = P.simular(t, resumo.du_mes, { ...OP, choque: -0.01 }).total;
  assert.ok(sobe < fica && fica < cai);
});

test("simular: no vencimento o prefixado paga a taxa contratada", () => {
  const t = titulo("prefixado-2029-01-01");
  const fim = P.simular(t, resumo.du_mes, { ...OP, meses: 9999, choque: 0.03 });
  const duFinal = t.fluxos.at(-1)[0];
  perto(fim.total, OP.valor * 1000 / t.pu_compra, 1e-6);              // choque nao importa no fim
  perto(fim.rentabilidade, t.taxa_compra / 100, 1e-4);              // PU oficial e arredondado no centavo
  assert.equal(fim.duH, duFinal);
});

test("simular: cupons entram no caminho e somam ao que se recebe no fim", () => {
  const t = titulo("prefixado-juros-2037-01-01");
  const r = P.simular(t, resumo.du_mes, { ...OP, meses: 30 });
  assert.ok(r.recebido > 0);
  const fim = P.simular(t, resumo.du_mes, { ...OP, meses: 9999 });
  perto(fim.total, fim.ateOFim, 1e-6);
});

test("simular: IPCA+ cresce com a inflacao premissa", () => {
  const t = titulo("ipca-2029-05-15");
  const baixa = P.simular(t, resumo.du_mes, { ...OP, inflacao: 0.03 }).total;
  const alta = P.simular(t, resumo.du_mes, { ...OP, inflacao: 0.06 }).total;
  assert.ok(alta > baixa);
});

test("simular: Tesouro Selic quase nao sente choque de juros", () => {
  const t = resumo.titulos.find((x) => x.indexador === "selic" && x.a_venda);
  const a = P.simular(t, resumo.du_mes, OP).total;
  const b = P.simular(t, resumo.du_mes, { ...OP, choque: 0.02 }).total;
  // O choque mexe so no agio/desagio: muito menos do que num prefixado.
  assert.ok(Math.abs(b / a - 1) < 0.06);
});

test("meses ate o vencimento respeita o ultimo fluxo", () => {
  const t = titulo("prefixado-2027-01-01");
  const m = P.mesesAteVencimento(resumo.du_mes, t.fluxos.at(-1)[0]);
  assert.ok(m >= 2 && m <= 3, String(m));
});
