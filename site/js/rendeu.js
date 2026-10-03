// "Quanto eu teria": uma compra real no passado, com os precos oficiais do dia,
// os pagamentos que o titulo fez no caminho e os custos de quem investe pelo
// Tesouro Direto. Tudo aqui e funcao pura; quem desenha e app.js.

const DIA = 86400000;

/** Aliquota do IR regressivo da renda fixa pelo prazo em dias corridos. */
export function aliquotaIR(dias) {
  if (dias <= 180) return 0.225;
  if (dias <= 360) return 0.2;
  if (dias <= 720) return 0.175;
  return 0.15;
}

// IOF regressivo sobre o rendimento nos primeiros 29 dias (Decreto 6.306/2007, anexo).
const IOF = [96, 93, 90, 86, 83, 80, 76, 73, 70, 66, 63, 60, 56, 53, 50,
  46, 43, 40, 36, 33, 30, 26, 23, 20, 16, 13, 10, 6, 3];

/** Fracao do rendimento que vai para o IOF apos `dias` corridos (0 a partir do 30o dia). */
export function aliquotaIOF(dias) {
  if (dias < 1) return 1;
  return dias >= 30 ? 0 : IOF[dias - 1] / 100;
}

export function diasEntre(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / DIA);
}

/** Indice do ultimo elemento de `datas` (ISO, crescente) <= d; -1 se nenhum. */
export function indiceAte(datas, d) {
  let lo = 0, hi = datas.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (datas[m] <= d) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}

/** Primeiro dia >= d em que o titulo estava a venda; null se nao houver. */
export function diaDeCompra(h, d) {
  for (let i = Math.max(0, indiceAte(h.datas, d)); i < h.datas.length; i++) {
    if (h.datas[i] >= d && h.pu_compra[i] > 0) return i;
  }
  return null;
}

/** Valor de um indexador acumulado entre duas datas (razao de VNAs); null sem dado. */
export function acumulado(vna, indexador, de, ate) {
  const i = indiceAte(vna.datas, de), j = indiceAte(vna.datas, ate);
  if (i < 0 || j < 0) return null;
  const a = vna[indexador][i], b = vna[indexador][j];
  return a && b ? b / a : null;
}

/** Taxa interna de retorno anual (dias corridos/365) por bissecao. fluxos: [[dataISO, valor]]. */
export function tir(fluxos) {
  const t0 = Date.parse(fluxos[0][0]);
  const vpl = (r) => fluxos.reduce((s, [d, v]) => s + v / Math.pow(1 + r, (Date.parse(d) - t0) / DIA / 365), 0);
  let lo = -0.99, hi = 10;
  if (vpl(lo) * vpl(hi) > 0) return NaN;
  for (let k = 0; k < 200; k++) {
    const m = (lo + hi) / 2;
    if (vpl(lo) * vpl(m) <= 0) hi = m; else lo = m;
  }
  return (lo + hi) / 2;
}

/** Parcelas mensais (Renda+/Educa+) que ainda faltavam pagar depois de `data`; 0 nos outros. */
export function parcelasRestantes(h, data) {
  const total = h.tipo.startsWith("Tesouro Renda+") ? 240 : h.tipo === "Tesouro Educa+" ? 60 : 0;
  if (!total) return 0;
  const [a, m, d] = h.vencimento.split("-").map(Number);
  let n = 0;
  for (let k = 0; k < total; k++) {
    const mes = a * 12 + (m - 1) - k;
    const iso = `${Math.floor(mes / 12)}-${String((mes % 12) + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (iso > data) n++;
  }
  return n;
}

/**
 * Simula a compra de `valor` reais do titulo `h` (historico/<id>.json) no dia
 * `compra` e a venda no dia `venda` (ou o vencimento, se vier antes).
 *
 * Simplificacoes, ditas na tela: IR sobre cada cupom inteiro e sobre o ganho
 * de capital da venda; custodia sobre o saldo medio, pro rata; prazos em dias
 * corridos entre as datas de preco.
 */
export function rendeu(h, vna, { valor, compra, venda, custodia = 0.002 }) {
  const ic = diaDeCompra(h, compra);
  if (ic === null) return { erro: "O título não estava à venda nessa data nem depois dela." };
  const dataCompra = h.datas[ic];
  const pu0 = h.pu_compra[ic];
  const qtd = valor / pu0;

  const ultimoPreco = h.datas[h.datas.length - 1];
  const vencimento = h.vencimento;
  const carregou = h.vencido && venda >= vencimento;
  let dataVenda, puVenda;
  if (carregou) {
    // O principal vem como ultimo pagamento, no dia util do vencimento.
    dataVenda = h.pagamentos.length ? h.pagamentos[h.pagamentos.length - 1][0] : vencimento;
    puVenda = 0;
  } else {
    const iv = indiceAte(h.datas, venda > ultimoPreco ? ultimoPreco : venda);
    if (iv < ic) return { erro: "A venda precisa ser depois da compra." };
    dataVenda = h.datas[iv];
    puVenda = h.pu_venda[iv];
  }
  const dias = diasEntre(dataCompra, dataVenda);

  // Renda+ e Educa+ devolvem o capital em parcelas: cada parcela carrega
  // 1/n do custo (n = parcelas que restavam na compra) e so o resto e renda.
  const nParcelas = parcelasRestantes(h, dataCompra);

  // Pagamentos entre a compra (exclusive) e a venda (inclusive).
  const pagamentos = [];
  let brutoPagamentos = 0, irPagamentos = 0;
  for (const [d, v] of h.pagamentos) {
    if (d <= dataCompra || d > dataVenda) continue;
    const bruto = qtd * v;
    const ehPrincipal = carregou && d === h.pagamentos[h.pagamentos.length - 1][0];
    // No vencimento o ultimo pagamento inclui o principal: o IR incide so sobre o ganho.
    const base = nParcelas ? Math.max(0, bruto - valor / nParcelas)
      : ehPrincipal ? Math.max(0, bruto - valor) : bruto;
    const ir = base * aliquotaIR(diasEntre(dataCompra, d));
    pagamentos.push({ data: d, bruto, ir });
    brutoPagamentos += bruto;
    irPagamentos += ir;
  }

  const brutoVenda = qtd * puVenda;
  // Custo que ainda nao voltou ao investidor (nas parcelas, parte ja voltou).
  const custoRestante = nParcelas ? valor * parcelasRestantes(h, dataVenda) / nParcelas : valor;
  const ganhoVenda = carregou ? 0 : brutoVenda - custoRestante;
  const iof = ganhoVenda > 0 ? ganhoVenda * aliquotaIOF(dias) : 0;
  const irVenda = ganhoVenda > 0 ? (ganhoVenda - iof) * aliquotaIR(dias) : 0;
  const saldoMedio = (valor + brutoVenda + brutoPagamentos) / 2;
  const taxaCustodia = saldoMedio * custodia * dias / 365;

  const bruto = brutoVenda + brutoPagamentos;
  const impostos = irVenda + irPagamentos + iof;
  const liquido = bruto - impostos - taxaCustodia;

  // TIR liquida: custodia descontada no fim, junto com a venda.
  const fluxos = [[dataCompra, -valor]];
  for (const p of pagamentos) fluxos.push([p.data, p.bruto - p.ir]);
  if (!carregou) fluxos.push([dataVenda, brutoVenda - irVenda - iof - taxaCustodia]);
  else fluxos[fluxos.length - 1][1] -= taxaCustodia;
  fluxos.sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const selic = acumulado(vna, "selic", dataCompra, dataVenda);
  const ipca = acumulado(vna, "ipca", dataCompra, dataVenda);
  const brutoSelic = selic ? valor * selic : null;
  const liquidoSelic = selic
    ? brutoSelic - (brutoSelic - valor) * aliquotaIR(dias) - (valor + brutoSelic) / 2 * custodia * dias / 365
    : null;

  return {
    dataCompra, dataVenda, carregou, dias, qtd, pu0, puVenda,
    pagamentos, brutoPagamentos, brutoVenda, bruto,
    irVenda, irPagamentos, iof, impostos, custodia: taxaCustodia, liquido,
    ganhoLiquido: liquido - valor,
    tirLiquida: dias > 0 ? tir(fluxos) : NaN,
    selic, ipca, brutoSelic, liquidoSelic,
    real: ipca ? liquido / valor / ipca - 1 : null,
  };
}

/** Serie do valor bruto da posicao dia a dia (preco de venda + pagamentos ja recebidos). */
export function serieDaPosicao(h, r) {
  const out = [];
  const i0 = h.datas.indexOf(r.dataCompra);
  let pagos = 0, k = 0;
  const pag = r.pagamentos;
  for (let i = i0; i < h.datas.length && h.datas[i] <= r.dataVenda; i++) {
    while (k < pag.length && pag[k].data <= h.datas[i]) pagos += pag[k++].bruto;
    out.push([h.datas[i], r.qtd * h.pu_venda[i] + pagos]);
  }
  if (r.carregou) out.push([r.dataVenda, r.bruto]);
  return out;
}
