// Precificacao no navegador: a mesma conta de curva/titulos.py, sobre os fluxos
// que o Python ja deixou prontos em dias uteis (resumo.json). Os testes em
// tests/js conferem que as duas implementacoes dao o mesmo numero.
//
//   cotacao = soma( fracao_i / (1 + taxa) ** ((du_i - duH) / 252) ),  du_i > duH
//
// duH e o "horizonte": quantos dias uteis depois da liquidacao de hoje o
// titulo e avaliado. duH = 0 e o preco de hoje.

/** Cotacao por unidade de base dos fluxos ainda nao pagos no horizonte duH. */
export function cotacao(fluxos, taxa, duH = 0) {
  let soma = 0;
  for (const [du, fracao] of fluxos) {
    if (du > duH) soma += fracao / Math.pow(1 + taxa, (du - duH) / 252);
  }
  return soma;
}

/** Soma (sem reinvestir) do que o titulo pagou ate o horizonte, por unidade de base. */
export function recebidoAte(fluxos, duH) {
  let soma = 0;
  for (const [du, fracao] of fluxos) if (du <= duH) soma += fracao;
  return soma;
}

/** Duration de Macaulay em anos. */
export function duration(fluxos, taxa, duH = 0) {
  let vp = 0, pond = 0;
  for (const [du, fracao] of fluxos) {
    if (du <= duH) continue;
    const anos = (du - duH) / 252;
    const v = fracao / Math.pow(1 + taxa, anos);
    vp += v;
    pond += v * anos;
  }
  return vp ? pond / vp : 0;
}

/** Variacao do preco se a taxa mudar `choque` (fracao: 0.01 = 1 p.p.) agora. */
export function sensibilidade(fluxos, taxa, choque) {
  return cotacao(fluxos, taxa + choque) / cotacao(fluxos, taxa) - 1;
}

/** Taxa (zero, % a.a. em fracao) interpolada linearmente em dias uteis; plana nas pontas. */
export function interpolar(pontos, du) {
  if (!pontos.length) return NaN;
  if (du <= pontos[0][0]) return pontos[0][1];
  for (let i = 1; i < pontos.length; i++) {
    const [d1, t1] = pontos[i];
    if (du <= d1) {
      const [d0, t0] = pontos[i - 1];
      return t0 + (t1 - t0) * (du - d0) / (d1 - d0);
    }
  }
  return pontos[pontos.length - 1][1];
}

/**
 * Curvas zero de hoje: prefixada (Tesouro Prefixado) e real (Tesouro IPCA+),
 * os dois titulos sem cupom -- a taxa deles ja e a taxa zero do prazo.
 * Devolve pontos [du, taxa] ordenados.
 */
export function curvasZero(titulos) {
  const pegar = (codigo) => titulos
    .filter((t) => t.codigo === codigo && t.a_venda)
    .map((t) => [t.du, t.taxa_compra / 100])
    .sort((a, b) => a[0] - b[0]);
  return { pre: pegar("LTN"), real: pegar("NTN-B Principal") };
}

/** Inflacao implicita ate o prazo du: (1 + pre) / (1 + real) - 1. */
export function inflacaoImplicita(zero, du) {
  return (1 + interpolar(zero.pre, du)) / (1 + interpolar(zero.real, du)) - 1;
}

/** Dias uteis ate `meses` meses depois da liquidacao (tabela du_mes do resumo). */
export function duDoMes(duMes, meses) {
  return duMes[Math.max(0, Math.min(duMes.length - 1, Math.round(meses)))];
}

/** Meses ate o ultimo fluxo do titulo (o maior m com du_mes[m] < du final). */
export function mesesAteVencimento(duMes, duFinal) {
  let m = 0;
  while (m + 1 < duMes.length && duMes[m + 1] < duFinal) m++;
  return m;
}

/**
 * "Simular": compra hoje, vende no horizonte com a taxa de venda deslocada.
 *
 * titulo  item de resumo.titulos
 * opcoes  { valor, meses, choque (fracao), inflacao (fracao a.a.), selic (fracao a.a.) }
 *
 * A base cresce com o indexador: R$ 1.000 fixos no prefixado, inflacao no
 * IPCA+/IGP-M+, Selic no Tesouro Selic. Pagamentos no caminho (cupons e
 * parcelas) entram pelo valor nominal, sem reinvestimento.
 */
export function simular(titulo, duMes, opcoes) {
  const { valor, meses, choque, inflacao = 0, selic = 0 } = opcoes;
  const fl = titulo.fluxos;
  const duFinal = fl[fl.length - 1][0];
  const duH = Math.min(duDoMes(duMes, meses), duFinal);
  const anos = duH / 252;
  // Fator de correcao da base ate du dias uteis pela premissa do indexador.
  const premissa = titulo.indexador === "selic" ? selic : inflacao;
  const correcao = (du) => (titulo.indexador === "pre" ? 1 : Math.pow(1 + premissa, du / 252));
  const quantidade = valor / titulo.pu_compra;
  const taxaCompra = titulo.taxa_compra / 100;
  const taxaVenda = titulo.taxa_venda / 100 + choque;

  // Pagamentos ate o horizonte (cada um com a base corrigida ate a data dele)
  // e, para comparar, todos os pagamentos de quem carrega ate o fim.
  let recebido = 0, ateOFim = 0;
  for (const [du, fracao] of fl) {
    const pagamento = quantidade * titulo.base * fracao * correcao(du);
    ateOFim += pagamento;
    if (du <= duH) recebido += pagamento;
  }
  const venda = quantidade * titulo.base * correcao(duH) * cotacao(fl, taxaVenda, duH);
  const total = venda + recebido;
  const rentabilidade = duH > 0 ? Math.pow(total / valor, 252 / duH) - 1 : 0;
  return {
    quantidade, duH, anos, venda, recebido, total,
    ganho: total - valor,
    rentabilidade,                                   // nominal, % a.a. em fracao
    real: (1 + rentabilidade) / (1 + inflacao) - 1,  // descontada a inflacao premissa
    ateOFim,
    duFinal,
    taxaCompra,
    taxaVenda,
  };
}
