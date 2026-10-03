import { test } from "node:test";
import assert from "node:assert/strict";
import * as R from "../../site/js/rendeu.js";

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} vs ${b}`);

test("tabela regressiva do IR nas fronteiras", () => {
  assert.equal(R.aliquotaIR(180), 0.225);
  assert.equal(R.aliquotaIR(181), 0.2);
  assert.equal(R.aliquotaIR(360), 0.2);
  assert.equal(R.aliquotaIR(361), 0.175);
  assert.equal(R.aliquotaIR(720), 0.175);
  assert.equal(R.aliquotaIR(721), 0.15);
});

test("IOF regressivo some no 30o dia", () => {
  assert.equal(R.aliquotaIOF(1), 0.96);
  assert.equal(R.aliquotaIOF(15), 0.5);
  assert.equal(R.aliquotaIOF(29), 0.03);
  assert.equal(R.aliquotaIOF(30), 0);
});

test("TIR de um ano exato", () => {
  perto(R.tir([["2025-01-01", -100], ["2026-01-01", 110]]), 0.10, 1e-6);
});

test("TIR com fluxo intermediario", () => {
  // 100 hoje, 10 em um ano, 110 em dois: 10% a.a. (em dias corridos/365, 2024 bissexto pesa pouco).
  perto(R.tir([["2025-01-01", -100], ["2026-01-01", 10], ["2027-01-01", 110]]), 0.10, 1e-6);
});

test("indiceAte acha o ultimo <= data", () => {
  const d = ["2026-01-02", "2026-01-05", "2026-01-06"];
  assert.equal(R.indiceAte(d, "2026-01-01"), -1);
  assert.equal(R.indiceAte(d, "2026-01-05"), 1);
  assert.equal(R.indiceAte(d, "2026-01-04"), 0);
  assert.equal(R.indiceAte(d, "2027-01-01"), 2);
});

// Um prefixado de brinquedo: comprado a 800, vendido a 900, sem cupom.
const H = {
  tipo: "Tesouro Prefixado", vencimento: "2030-01-01", vencido: false,
  datas: ["2024-01-02", "2025-01-02", "2026-01-02"],
  pu_compra: [800, 850, 0], pu_venda: [798, 848, 900],
  pagamentos: [],
};
const VNA = { datas: ["2024-01-02", "2026-01-02"], selic: [100, 125], ipca: [100, 109], igpm: [null, null] };

test("rendeu: ganho de capital com IR de 15% depois de 2 anos", () => {
  const r = R.rendeu(H, VNA, { valor: 8000, compra: "2024-01-02", venda: "2026-01-02", custodia: 0 });
  assert.equal(r.qtd, 10);
  perto(r.brutoVenda, 9000, 1e-9);
  perto(r.irVenda, 1000 * 0.15, 1e-9);
  perto(r.liquido, 9000 - 150, 1e-9);
  perto(r.selic, 1.25, 1e-12);
  perto(r.ipca, 1.09, 1e-12);
  perto(r.liquidoSelic, 10000 - 2000 * 0.15, 1e-9);
});

test("rendeu: custodia proporcional ao saldo medio", () => {
  const r = R.rendeu(H, VNA, { valor: 8000, compra: "2024-01-02", venda: "2026-01-02", custodia: 0.002 });
  perto(r.custodia, (8000 + 9000) / 2 * 0.002 * r.dias / 365, 1e-9);
});

test("rendeu: compra em dia sem oferta pula para o proximo dia a venda", () => {
  const r = R.rendeu(H, VNA, { valor: 8000, compra: "2023-06-01", venda: "2026-01-02" });
  assert.equal(r.dataCompra, "2024-01-02");
});

test("rendeu: venda antes da compra e erro", () => {
  const r = R.rendeu(H, VNA, { valor: 8000, compra: "2025-01-02", venda: "2024-06-01" });
  assert.ok(r.erro);
});

test("rendeu: carregar ate o vencimento recebe o principal como pagamento", () => {
  const h = { ...H, vencido: true, vencimento: "2026-01-01", pagamentos: [["2026-01-02", 1000]] };
  const r = R.rendeu(h, VNA, { valor: 8000, compra: "2024-01-02", venda: "2030-01-01", custodia: 0 });
  assert.ok(r.carregou);
  perto(r.bruto, 10000, 1e-9);
  perto(r.irPagamentos, 2000 * 0.15, 1e-9);   // IR so sobre o ganho, nao sobre o principal
});

test("parcelas restantes do Renda+ e do Educa+", () => {
  const renda = { tipo: "Tesouro Renda+ Aposentadoria Extra", vencimento: "2084-12-15" };
  assert.equal(R.parcelasRestantes(renda, "2030-01-01"), 240);
  assert.equal(R.parcelasRestantes(renda, "2065-01-15"), 239);
  const educa = { tipo: "Tesouro Educa+", vencimento: "2030-12-15" };
  assert.equal(R.parcelasRestantes(educa, "2026-10-02"), 3 + 12 * 4);
  assert.equal(R.parcelasRestantes({ tipo: "Tesouro Prefixado", vencimento: "2030-01-01" }, "2026-01-01"), 0);
});
