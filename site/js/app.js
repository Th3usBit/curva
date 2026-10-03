// Interface do curva: carrega os JSON gerados pelo Python e desenha as abas.
//
// Tres abas (Titulos de hoje, Simular, Quanto eu teria) e uma pagina de
// metodologia no rodape. Navegacao por hash: o botao voltar funciona, cada aba
// tem seu link, e ao trocar de aba o foco vai para o titulo dela.

import * as P from "./precos.js";
import * as R from "./rendeu.js";
import * as F from "./formato.js";
import { desenhar } from "./grafico.js";

const $ = (sel) => document.querySelector(sel);
const estado = { resumo: null, vna: null, catalogo: null, historicos: new Map() };
const CUSTODIA = 0.002;   // taxa de custodia da B3, 0,20% ao ano

// ---------- utilitarios ----------

/** Cria um elemento; textos entram como texto, nunca HTML. */
function h(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f !== null && f !== undefined && f !== false) e.append(f instanceof Node ? f : String(f));
  return e;
}

async function json(caminho) {
  const r = await fetch(caminho, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status}`);
  return r.json();
}

async function historico(id) {
  if (!estado.historicos.has(id)) estado.historicos.set(id, json(`dados/historico/${id}.json`));
  return estado.historicos.get(id);
}

/** Como o titulo rende, em linguagem de gente: "13,37%" ou "IPCA + 7,55%". */
function textoTaxa(indexador, taxa) {
  const t = F.taxa(taxa);
  if (indexador === "ipca") return `IPCA + ${t}`;
  if (indexador === "igpm") return `IGP-M + ${t}`;
  if (indexador === "selic") return `Selic + ${t}`;
  return t;
}

const nomeCurto = (t) => t.nome.replace("Tesouro ", "").replace(" Aposentadoria Extra", "");

function somarMeses(iso, m) {
  const [a, mes, d] = iso.split("-").map(Number);
  const total = a * 12 + (mes - 1) + m;
  const ano = Math.floor(total / 12), mm = total % 12;
  const ultimo = new Date(Date.UTC(ano, mm + 1, 0)).getUTCDate();
  return `${ano}-${String(mm + 1).padStart(2, "0")}-${String(Math.min(d, ultimo)).padStart(2, "0")}`;
}

function amostrar(pontos, max = 700) {
  if (pontos.length <= max) return pontos;
  const passo = pontos.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(pontos[Math.floor(i * passo)]);
  out.push(pontos[pontos.length - 1]);
  return out;
}

function botoesFiltro(alvo, opcoes, inicial, aoEscolher) {
  alvo.replaceChildren();
  for (const [valor, rotulo] of opcoes) {
    alvo.append(h("button", {
      type: "button", "aria-pressed": String(valor === inicial),
      onclick: (ev) => {
        for (const b of alvo.children) b.setAttribute("aria-pressed", "false");
        ev.currentTarget.setAttribute("aria-pressed", "true");
        aoEscolher(valor);
      },
    }, rotulo));
  }
}

function tile(rotulo, valor, nota) {
  return h("div", { class: "tile" },
    h("div", { class: "tile-rotulo" }, rotulo),
    h("div", { class: "tile-valor" }, valor),
    nota ? h("div", { class: "tile-nota" }, nota) : null);
}

function delta(valor, sufixo) {
  return h("span", { class: `heroi-delta ${valor >= 0 ? "positivo" : "negativo"}` },
    `${valor >= 0 ? "+" : "−"}${F.brl(Math.abs(valor))}${sufixo}`);
}

const ORDEM_TIPOS = [
  "Tesouro Selic", "Tesouro Prefixado", "Tesouro Prefixado com Juros Semestrais",
  "Tesouro IPCA+", "Tesouro IPCA+ com Juros Semestrais", "Tesouro Renda+ Aposentadoria Extra",
  "Tesouro Educa+", "Tesouro IGPM+ com Juros Semestrais",
];
const ordemTipo = (t) => { const i = ORDEM_TIPOS.indexOf(t); return i < 0 ? 99 : i; };

function opcoesAgrupadas(select, itens, rotulo) {
  select.replaceChildren();
  const grupos = new Map();
  for (const t of [...itens].sort((a, b) => ordemTipo(a.tipo) - ordemTipo(b.tipo) || a.vencimento.localeCompare(b.vencimento))) {
    if (!grupos.has(t.tipo)) grupos.set(t.tipo, h("optgroup", { label: t.tipo.replace(" Aposentadoria Extra", "") }));
    grupos.get(t.tipo).append(h("option", { value: t.id }, rotulo(t)));
  }
  for (const g of grupos.values()) select.append(g);
}

// ---------- navegacao ----------

const ABAS = {
  hoje: { iniciar: iniciarHoje, titulo: "Títulos de hoje" },
  simular: { iniciar: iniciarSimular, titulo: "Simular uma compra" },
  "quanto-teria": { iniciar: iniciarTeria, titulo: "Quanto eu teria" },
  metodologia: { iniciar: iniciarMetodologia, titulo: "Como os números são calculados" },
};
const iniciadas = new Set();
const redesenhar = {};
let abaVisivel = null;

async function mostrarAba(id, { focar = false } = {}) {
  const mudou = id !== abaVisivel;
  abaVisivel = id;
  for (const s of document.querySelectorAll(".aba")) s.hidden = s.id !== id;
  for (const a of document.querySelectorAll(".abas a")) {
    if (a.dataset.aba === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  document.title = `${ABAS[id].titulo} · curva`;
  if (mudou && focar) {
    scrollTo({ top: 0 });
    document.getElementById(id).querySelector("h1")?.focus({ preventScroll: true });
  }
  if (!iniciadas.has(id)) {
    iniciadas.add(id);
    try { await ABAS[id].iniciar(); } catch (e) { erroNaAba(id, e); }
  }
}

function erroNaAba(id, e) {
  console.error(e);
  document.getElementById(id).append(h("p", { class: "erro" }, "Não consegui carregar esta parte. Tente recarregar a página."));
}

function iniciarTema() {
  $(".tema").addEventListener("click", () => {
    const raiz = document.documentElement;
    const escuroAgora = raiz.dataset.theme
      ? raiz.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    raiz.dataset.theme = escuroAgora ? "light" : "dark";
    try { localStorage.setItem("curva-tema", raiz.dataset.theme); } catch { /* sem armazenamento */ }
    redesenhar[abaVisivel]?.();   // os graficos leem as cores do CSS
  });
}

function faixa() {
  const { resumo } = estado;
  const el = $("#faixa");
  const dias = R.diasEntre(resumo.data, new Date().toISOString().slice(0, 10));
  el.textContent = `Preços oficiais de ${F.data(resumo.data)}, atualizados automaticamente.`;
  if (dias > 6) {
    el.classList.add("alerta");
    el.textContent = `Atenção: os preços são de ${F.data(resumo.data)}, há ${dias} dias. A atualização automática pode ter parado.`;
  }
}

// ---------- TITULOS DE HOJE ----------

function iniciarHoje() {
  const { resumo } = estado;
  const tipos = [...new Set(resumo.titulos.map((t) => t.tipo))].sort((a, b) => ordemTipo(a) - ordemTipo(b));
  const curtos = Object.fromEntries(resumo.titulos.map((t) => [t.tipo, t.curto]));
  let filtro = "todos";
  botoesFiltro($("#filtros"), [["todos", "Todos"], ...tipos.map((t) => [t, curtos[t]])], "todos", (v) => { filtro = v; tabela(); });

  let selecionado = null;
  let periodo = "5";
  botoesFiltro($("#detalhe-periodos"), [["1", "1 ano"], ["5", "5 anos"], ["tudo", "Tudo"]], periodo, (v) => { periodo = v; detalhe(); });

  function tabela() {
    const tb = $("#tabela tbody");
    tb.replaceChildren();
    for (const tipo of tipos) {
      if (filtro !== "todos" && filtro !== tipo) continue;
      tb.append(h("tr", { class: "grupo" }, h("th", { colspan: 4, scope: "colgroup" }, tipo.replace(" Aposentadoria Extra", ""))));
      for (const t of resumo.titulos.filter((x) => x.tipo === tipo).sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
        const quando = t.codigo === "NTN-B1"
          ? `paga de ${t.ano} a ${t.vencimento.slice(0, 4)}`
          : `vence em ${F.data(t.vencimento)}`;
        tb.append(h("tr", {
          tabindex: 0, "aria-selected": String(t.id === selecionado), dataset: { id: t.id },
          onclick: () => escolher(t.id),
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); escolher(t.id); } },
        },
          h("td", {}, h("div", { class: "titulo-nome" }, nomeCurto(t)), h("div", { class: "titulo-sub" }, quando)),
          h("td", { class: "num" }, t.a_venda ? textoTaxa(t.indexador, t.taxa_compra) : h("span", { class: "fora" }, "fora de venda")),
          h("td", { class: "num" }, F.brl(t.a_venda ? t.pu_compra : t.pu_venda)),
          h("td", { class: "num col-vence" }, t.codigo === "NTN-B1" ? `${t.ano}–${t.vencimento.slice(0, 4)}` : F.data(t.vencimento)),
        ));
      }
    }
  }

  function escolher(id) {
    selecionado = id;
    for (const tr of document.querySelectorAll("#tabela tbody tr[data-id]")) tr.setAttribute("aria-selected", String(tr.dataset.id === id));
    detalhe().then(() => $("#detalhe").scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
    }));
  }

  async function detalhe() {
    if (!selecionado) return;
    const t = resumo.titulos.find((x) => x.id === selecionado);
    $("#detalhe").hidden = false;
    $("#detalhe-titulo").textContent = t.nome;
    const hist = await historico(t.id);
    const inicio = periodo === "tudo" ? "0000" : somarMeses(resumo.data, -12 * Number(periodo));
    const precos = [];
    hist.datas.forEach((d, i) => { if (d >= inicio && hist.pu_venda[i] > 0) precos.push([d, hist.pu_venda[i]]); });
    desenhar($("#g-preco"), {
      series: [{ nome: "Preço", pontos: amostrar(precos), estilo: "linha", cor: 1 }],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.num(v, 0)) },
      descricao: `Preço do ${t.nome} ao longo do tempo`,
    });
    const notas = {
      pre: "O preço sobe até R$ 1.000 no vencimento, mas no caminho cai quando os juros do mercado sobem. Quem vende num desses dias recebe menos.",
      ipca: "O preço sobe com a inflação, mas cai quando os juros do mercado sobem. Quem fica até o vencimento recebe o combinado.",
      igpm: "O preço sobe com o IGP-M, mas cai quando os juros do mercado sobem.",
      selic: "O Tesouro Selic sobe um pouco todo dia e quase não cai. Por isso é o indicado para a reserva de emergência.",
    };
    $("#detalhe-nota").textContent = notas[t.indexador];
  }

  tabela();
  redesenhar.hoje = detalhe;
}

// ---------- SIMULAR ----------

function iniciarSimular() {
  const { resumo } = estado;
  const titulos = resumo.titulos.filter((t) => t.a_venda);
  const zero = P.curvasZero(resumo.titulos);
  const sel = $("#s-titulo");
  opcoesAgrupadas(sel, titulos, (t) => `${nomeCurto(t)} · ${textoTaxa(t.indexador, t.taxa_compra)}`);
  sel.value = (titulos.filter((t) => t.codigo === "LTN").sort((a, b) => b.du - a.du)[0] || titulos[0]).id;

  function atualizar() {
    const t = titulos.find((x) => x.id === sel.value);
    const duFinal = t.fluxos[t.fluxos.length - 1][0];
    const maxMeses = Math.max(1, P.mesesAteVencimento(resumo.du_mes, duFinal));
    const slider = $("#s-meses");
    slider.max = maxMeses;
    if (Number(slider.value) > maxMeses) slider.value = maxMeses;
    const meses = Number(slider.value);
    const dataVenda = somarMeses(resumo.liquidacao, meses);
    $("#s-meses-txt").textContent = `${F.meses(meses)} (${F.mesAno(dataVenda)})`;

    // Premissas automaticas: o que o proprio mercado embute para o prazo.
    const duH = Math.max(P.duDoMes(resumo.du_mes, meses), 21);
    const op = {
      valor: Math.max(1, Number($("#s-valor").value) || 0),
      meses,
      choque: Number($("#s-juros").value) / 100,
      inflacao: P.inflacaoImplicita(zero, duH),
      selic: P.interpolar(zero.pre, duH),
    };
    const r = P.simular(t, resumo.du_mes, op);
    const igual = P.simular(t, resumo.du_mes, { ...op, choque: 0 });
    const fim = P.simular(t, resumo.du_mes, { ...op, meses: maxMeses + 1 });

    const cenario = { "-2": "caírem bastante", "-1": "caírem um pouco", 0: "ficarem iguais", 1: "subirem um pouco", 2: "subirem bastante" }[$("#s-juros").value];
    $("#s-resultado").replaceChildren(
      h("p", { class: "heroi-rotulo" }, `Você receberia em ${F.mesAno(dataVenda)}`),
      h("div", { class: "heroi" },
        h("span", { class: "heroi-valor" }, F.brl(r.total)),
        delta(r.total - op.valor, ` (${F.pct(r.rentabilidade)} ao ano)`)),
      h("p", { class: "frase" },
        `Investindo ${F.brl(op.valor)} hoje no ${nomeCurto(t)} e vendendo daqui a ${F.meses(meses)}, se os juros do mercado ${cenario}.`),
      h("div", { class: "comparacoes" },
        op.choque !== 0 ? tile("Se os juros ficarem iguais", F.brl(igual.total), `${F.pct(igual.rentabilidade)} ao ano`) : null,
        tile(`Se ficar até o vencimento (${F.mesAno(t.vencimento)})`, F.brl(fim.ateOFim), "sem risco de vender na baixa"),
      ),
    );

    const passo = maxMeses > 180 ? 3 : 1;
    const caminho = [], semMudanca = [];
    for (let m = 0; m <= maxMeses; m += passo) {
      const d = somarMeses(resumo.liquidacao, m);
      caminho.push([d, P.simular(t, resumo.du_mes, { ...op, meses: m }).total]);
      semMudanca.push([d, P.simular(t, resumo.du_mes, { ...op, meses: m, choque: 0 }).total]);
    }
    desenhar($("#g-simular"), {
      series: op.choque === 0
        ? [{ nome: "Juros iguais", pontos: caminho, estilo: "linha", cor: 1 }]
        : [
          { nome: `Juros ${op.choque > 0 ? "subindo" : "caindo"}`, pontos: caminho, estilo: "linha", cor: 1 },
          { nome: "Juros iguais", pontos: semMudanca, estilo: "linha", cor: 2, tracejado: true },
        ],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.brlInteiro(v)) },
      refs: [{ eixo: "y", valor: op.valor, rotulo: "investido" }, { eixo: "x", valor: dataVenda, rotulo: "venda" }],
      descricao: "Valor do investimento mês a mês até o vencimento",
    });

    const premissa = t.indexador === "ipca" || t.indexador === "igpm"
      ? ` Para a inflação, usamos a que o mercado espera para o período: ${F.pct(op.inflacao, 1)} ao ano.`
      : t.indexador === "selic" ? ` Para a Selic, usamos a que o mercado espera para o período: ${F.pct(op.selic, 1)} ao ano.` : "";
    $("#s-nota").textContent = `Valores antes do imposto de renda.${premissa} "Juros do mercado" são as taxas que o Tesouro oferece no dia da venda; 1 ponto é, por exemplo, ir de 13% para 14% ao ano.`;
  }

  $("#form-simular").addEventListener("input", atualizar);
  $("#form-simular").addEventListener("change", atualizar);
  $("#form-simular").addEventListener("submit", (ev) => ev.preventDefault());
  atualizar();
  redesenhar.simular = atualizar;
}

// ---------- QUANTO EU TERIA ----------

async function iniciarTeria() {
  [estado.catalogo, estado.vna] = await Promise.all([
    estado.catalogo ?? json("dados/titulos.json"),
    estado.vna ?? json("dados/vna.json"),
  ]);
  const sel = $("#r-titulo");
  opcoesAgrupadas(sel, estado.catalogo, (t) => `${nomeCurto(t)}${t.vencido ? " (já venceu)" : ""}`);
  sel.value = (estado.catalogo.find((t) => t.id.startsWith("ipca-") && !t.vencido && t.inicio <= "2018-01-01") || estado.catalogo[0]).id;
  const compra = $("#r-compra"), venda = $("#r-venda");

  function datasPadrao() {
    const t = estado.catalogo.find((x) => x.id === sel.value);
    compra.min = venda.min = t.inicio;
    compra.max = t.fim;
    venda.max = t.vencido ? t.vencimento : t.fim;
    const tresAnos = somarMeses(estado.resumo.data, -36);
    compra.value = t.inicio > tresAnos || t.fim < tresAnos ? t.inicio : tresAnos;
    venda.value = t.vencido ? t.vencimento : t.fim;
  }
  sel.addEventListener("change", () => { datasPadrao(); atualizar(); });
  datasPadrao();

  let pedido = 0;
  async function atualizar() {
    const meu = ++pedido;
    const t = estado.catalogo.find((x) => x.id === sel.value);
    const hist = await historico(t.id);
    if (meu !== pedido) return;
    const valor = Math.max(1, Number($("#r-valor").value) || 0);
    const r = R.rendeu(hist, estado.vna, { valor, compra: compra.value, venda: venda.value, custodia: CUSTODIA });
    const res = $("#r-resultado");
    if (r.erro) { res.replaceChildren(h("p", { class: "erro" }, r.erro)); $("#g-teria").replaceChildren(); return; }

    const ajuste = r.dataCompra !== compra.value ? " (primeiro dia à venda depois da data escolhida)" : "";
    const saida = r.carregou ? `ficasse até o vencimento (${F.data(r.dataVenda)})` : `vendesse em ${F.data(r.dataVenda)}`;
    const pagos = r.pagamentos.length - (r.carregou ? 1 : 0);
    const tipoPagamento = hist.tipo.includes("Renda+") || hist.tipo.includes("Educa+") ? "parcelas" : "pagamentos de juros";
    res.replaceChildren(
      h("p", { class: "heroi-rotulo" }, "Você teria, já descontados imposto e taxas"),
      h("div", { class: "heroi" },
        h("span", { class: "heroi-valor" }, F.brl(r.liquido)),
        delta(r.ganhoLiquido, ` (${F.pct(r.tirLiquida)} ao ano)`)),
      h("p", { class: "frase" },
        `Se tivesse investido ${F.brl(valor)} no ${nomeCurto(t)} em ${F.data(r.dataCompra)}${ajuste} e ${saida}.`,
        pagos > 0 ? ` Inclui ${pagos} ${tipoPagamento} recebidos no caminho.` : ""),
      h("div", { class: "comparacoes" },
        r.liquidoSelic !== null ? tile("No Tesouro Selic, teria", F.brl(r.liquidoSelic), "mesmo período, já descontado") : null,
        r.ipca !== null ? tile("Inflação no período", F.pct(r.ipca - 1),
          `seu dinheiro ${r.real >= 0 ? "ganhou" : "perdeu"} ${F.pct(Math.abs(r.real))} ${r.real >= 0 ? "acima" : "para"} dela`) : null,
      ),
      h("details", { class: "dados" },
        h("summary", {}, "Ver a conta"),
        h("table", { class: "decomposicao" }, h("tbody", {},
          linha("Investido", F.brl(valor)),
          linha(r.carregou ? "Recebido no vencimento" : "Venda", F.brl(r.carregou ? r.pagamentos.at(-1)?.bruto ?? 0 : r.brutoVenda)),
          pagos > 0 ? linha(`${tipoPagamento[0].toUpperCase()}${tipoPagamento.slice(1)} (${pagos})`, F.brl(r.brutoPagamentos - (r.carregou ? r.pagamentos.at(-1).bruto : 0))) : null,
          linha("Imposto de renda", `−${F.brl(r.irVenda + r.irPagamentos)}`),
          r.iof > 0 ? linha("IOF", `−${F.brl(r.iof)}`) : null,
          linha("Taxa da B3 (custódia)", `−${F.brl(r.custodia)}`),
          h("tr", { class: "total" }, h("td", {}, "Você teria"), h("td", {}, F.brl(r.liquido))),
        ))),
    );

    const posicao = R.serieDaPosicao(hist, r);
    const selic = [], ipca = [];
    for (const [d] of posicao) {
      const s = R.acumulado(estado.vna, "selic", r.dataCompra, d);
      const i = R.acumulado(estado.vna, "ipca", r.dataCompra, d);
      if (s) selic.push([d, valor * s]);
      if (i) ipca.push([d, valor * i]);
    }
    desenhar($("#g-teria"), {
      series: [
        { nome: nomeCurto(t), pontos: amostrar(posicao), estilo: "linha", cor: 1 },
        { nome: "Tesouro Selic", pontos: amostrar(selic), estilo: "linha", cor: 2 },
        { nome: "Inflação", pontos: amostrar(ipca), estilo: "linha", cor: 3, tracejado: true },
      ],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.brlInteiro(v)) },
      refs: [{ eixo: "y", valor, rotulo: "investido" }],
      descricao: "Valor do investimento, antes de impostos, comparado com o Tesouro Selic e a inflação",
    });
  }
  function linha(rotulo, v) { return h("tr", {}, h("td", {}, rotulo), h("td", {}, v)); }

  $("#form-teria").addEventListener("change", atualizar);
  $("#form-teria").addEventListener("input", (ev) => { if (ev.target.type === "number") atualizar(); });
  $("#form-teria").addEventListener("submit", (ev) => ev.preventDefault());
  await atualizar();
  redesenhar["quanto-teria"] = atualizar;
}

// ---------- METODOLOGIA ----------

async function iniciarMetodologia() {
  const v = await json("dados/validacao.json");
  const tb = $("#tabela-validacao tbody");
  for (const [tipo, e] of Object.entries(v.por_tipo).sort((a, b) => ordemTipo(a[0]) - ordemTipo(b[0]))) {
    tb.append(h("tr", {},
      h("td", {}, tipo),
      h("td", { class: "num" }, F.num(e.n, 0)),
      h("td", { class: "num" }, F.brl(e.mediana)),
      h("td", { class: "num" }, F.pct(e.ate_1_centavo, 1)),
      h("td", { class: "num" }, F.pct(e.ate_10_centavos, 1)),
    ));
  }
  tb.append(h("tr", {},
    h("td", {}, h("strong", {}, "Todos")),
    h("td", { class: "num" }, h("strong", {}, F.num(v.geral.n, 0))),
    h("td", { class: "num" }, ""),
    h("td", { class: "num" }, h("strong", {}, F.pct(v.geral.ate_1_centavo, 1))),
    h("td", { class: "num" }, h("strong", {}, F.pct(v.geral.ate_10_centavos, 1))),
  ));
  if (v.dias_inconsistentes.length) {
    $("#limitacoes").append(h("li", {},
      `Dias em que nem o próprio arquivo oficial fecha, deixados de fora da validação: ${v.dias_inconsistentes.map(F.data).join(", ")}.`));
  }
}

// ---------- partida ----------

async function iniciar() {
  iniciarTema();
  try {
    estado.resumo = await json("dados/resumo.json");
  } catch (e) {
    console.error(e);
    $("#faixa").textContent = "Não consegui carregar os dados. Tente recarregar a página.";
    $("#faixa").classList.add("alerta");
    return;
  }
  faixa();
  // Ancoras que nao sao abas (como "pular para o conteudo") nao trocam a aba.
  addEventListener("hashchange", () => {
    const id = location.hash.slice(1);
    if (ABAS[id]) mostrarAba(id, { focar: true });
  });
  const inicial = location.hash.slice(1);
  mostrarAba(ABAS[inicial] ? inicial : "hoje");
}

iniciar();
