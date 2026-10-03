// Interface do curva: carrega os JSON gerados pelo Python e desenha as abas.

import * as P from "./precos.js";
import * as R from "./rendeu.js";
import * as F from "./formato.js";
import { desenhar } from "./grafico.js";

const $ = (sel) => document.querySelector(sel);
const estado = { resumo: null, curvas: null, vna: null, catalogo: null, historicos: new Map() };

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

function textoTaxa(indexador, taxa) {
  const t = F.taxa(taxa);
  if (indexador === "ipca") return `IPCA + ${t}`;
  if (indexador === "igpm") return `IGP-M + ${t}`;
  if (indexador === "selic") return `Selic + ${t}`;
  return t;
}

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

function tile(rotulo, valor, nota, classe) {
  return h("div", { class: "tile" },
    h("div", { class: "tile-rotulo" }, rotulo),
    h("div", { class: `tile-valor${classe ? " " + classe : ""}` }, valor),
    nota ? h("div", { class: "tile-nota" }, nota) : null);
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
    if (!grupos.has(t.tipo)) grupos.set(t.tipo, h("optgroup", { label: t.tipo }));
    grupos.get(t.tipo).append(h("option", { value: t.id }, rotulo(t)));
  }
  for (const g of grupos.values()) select.append(g);
}

// ---------- tema e abas ----------

function iniciarTema() {
  $(".tema").addEventListener("click", () => {
    const raiz = document.documentElement;
    const escuroAgora = raiz.dataset.theme
      ? raiz.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    raiz.dataset.theme = escuroAgora ? "light" : "dark";
    try { localStorage.setItem("curva-tema", raiz.dataset.theme); } catch { /* sem armazenamento */ }
    // Os graficos leem as cores do CSS; redesenhar a aba visivel.
    mostrarAba(abaAtual(), true);
  });
}

const iniciadas = new Set();
const INICIAR = { hoje: iniciarHoje, curva: iniciarCurva, "e-se": iniciarEse, rendeu: iniciarRendeu, "como-funciona": iniciarComo, metodologia: iniciarMetodologia };
const REDESENHAR = {};

let ultimaAba = "hoje";
function abaAtual() {
  // Ancoras que nao sao abas (como o "pular para o conteudo") mantem a aba atual.
  const id = location.hash.slice(1);
  if (INICIAR[id]) ultimaAba = id;
  return ultimaAba;
}

async function mostrarAba(id, redesenhar = false) {
  for (const s of document.querySelectorAll(".aba")) s.hidden = s.id !== id;
  for (const a of document.querySelectorAll(".abas a")) {
    if (a.dataset.aba === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
  if (!iniciadas.has(id)) {
    iniciadas.add(id);
    try { await INICIAR[id](); } catch (e) { erroNaAba(id, e); }
  } else if (redesenhar && REDESENHAR[id]) {
    REDESENHAR[id]();
  }
}

function erroNaAba(id, e) {
  console.error(e);
  const s = document.getElementById(id);
  s.append(h("p", { class: "erro" }, "Não consegui carregar esta parte. Tente recarregar a página."));
}

// ---------- faixa de status ----------

function faixa() {
  const { resumo } = estado;
  const el = $("#faixa");
  const dias = R.diasEntre(resumo.data, new Date().toISOString().slice(0, 10));
  el.textContent = `Preços do Tesouro Direto de ${F.data(resumo.data)} · fonte: Tesouro Nacional, dados abertos · atualizado automaticamente`;
  if (dias > 6) {
    el.classList.add("alerta");
    el.textContent = `Atenção: os preços são de ${F.data(resumo.data)}, há ${dias} dias. A atualização automática pode ter parado.`;
  }
}

// ---------- HOJE ----------

function iniciarHoje() {
  const { resumo } = estado;
  const zero = P.curvasZero(resumo.titulos);
  const pre5 = P.interpolar(zero.pre, 5 * 252);
  const real10 = P.interpolar(zero.real, 10 * 252);
  const inf5 = P.inflacaoImplicita(zero, 5 * 252);
  const selic = resumo.titulos.filter((t) => t.indexador === "selic" && t.a_venda).sort((a, b) => a.du - b.du)[0];
  $("#tiles").replaceChildren(
    tile("Prefixado, 5 anos", F.pct(pre5), "juro nominal por ano, travado"),
    tile("IPCA+, 10 anos", `IPCA + ${F.pct(real10)}`, "ganho real por ano, travado"),
    tile("Inflação implícita, 5 anos", F.pct(inf5), "IPCA médio que o mercado embute"),
    selic ? tile("Tesouro Selic", F.brl(selic.pu_compra), `${selic.nome.replace("Tesouro ", "")}, preço de um título`) : null,
  );

  const tipos = [...new Set(resumo.titulos.map((t) => t.tipo))].sort((a, b) => ordemTipo(a) - ordemTipo(b));
  let filtro = "todos";
  const curtos = Object.fromEntries(resumo.titulos.map((t) => [t.tipo, t.curto]));
  botoesFiltro($("#filtros"), [["todos", "Todos"], ...tipos.map((t) => [t, curtos[t]])], "todos", (v) => { filtro = v; tabela(); });

  let selecionado = (resumo.titulos.filter((t) => t.codigo === "LTN" && t.a_venda).sort((a, b) => b.du - a.du)[0] || resumo.titulos[0]).id;

  function tabela() {
    const tb = $("#tabela tbody");
    tb.replaceChildren();
    for (const tipo of tipos) {
      if (filtro !== "todos" && filtro !== tipo) continue;
      tb.append(h("tr", { class: "grupo" }, h("td", { colspan: 6 }, tipo)));
      for (const t of resumo.titulos.filter((x) => x.tipo === tipo).sort((a, b) => a.vencimento.localeCompare(b.vencimento))) {
        const taxa = (t.a_venda ? t.taxa_compra : t.taxa_venda) / 100;
        const sens = P.sensibilidade(t.fluxos, taxa, 0.01);
        const sub = t.codigo === "NTN-B1"
          ? `paga de jan/${t.ano} a ${F.mesAno(t.vencimento)}`
          : `vence em ${F.data(t.vencimento)}`;
        const tr = h("tr", {
          tabindex: 0, "aria-selected": String(t.id === selecionado), dataset: { id: t.id },
          onclick: () => escolher(t.id),
          onkeydown: (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); escolher(t.id); } },
        },
          h("td", {}, h("div", { class: "titulo-nome" }, t.nome.replace("Tesouro ", "")), h("div", { class: "titulo-sub" }, sub)),
          h("td", { class: "num" }, t.a_venda ? textoTaxa(t.indexador, t.taxa_compra) : h("span", { class: "fora" }, "só recompra")),
          h("td", { class: "num" }, F.brl(t.a_venda ? t.pu_compra : t.pu_venda)),
          h("td", { class: "num col-prazo" }, F.prazo(t.duration)),
          h("td", { class: "num queda" }, F.pctSinal(sens)),
          h("td", { class: "col-ver" }, h("button", { class: "ver", type: "button", tabindex: -1, "aria-label": `Ver histórico de ${t.nome}` }, "histórico ›")),
        );
        tb.append(tr);
      }
    }
  }

  let periodo = "5";
  botoesFiltro($("#detalhe-periodos"), [["1", "1 ano"], ["5", "5 anos"], ["tudo", "Tudo"]], periodo, (v) => { periodo = v; detalhe(); });

  function escolher(id) {
    selecionado = id;
    for (const tr of document.querySelectorAll("#tabela tbody tr[data-id]")) tr.setAttribute("aria-selected", String(tr.dataset.id === id));
    detalhe();
    $("#detalhe").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  async function detalhe() {
    const t = resumo.titulos.find((x) => x.id === selecionado);
    const painel = $("#detalhe");
    painel.hidden = false;
    $("#detalhe-titulo").textContent = t.nome;
    const hist = await historico(t.id);
    const inicio = periodo === "tudo" ? "0000" : somarMeses(resumo.data, -12 * Number(periodo));
    const taxas = [], precos = [];
    hist.datas.forEach((d, i) => {
      if (d < inicio) return;
      if (hist.pu_compra[i] > 0) taxas.push([d, hist.taxa_compra[i]]);
      if (hist.pu_venda[i] > 0) precos.push([d, hist.pu_venda[i]]);
    });
    desenhar($("#g-taxa"), {
      series: [{ nome: "Taxa de compra", pontos: amostrar(taxas), estilo: "linha", cor: 1 }],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v) => `${F.num(v, 2)}%` },
      descricao: `Taxa de compra do ${t.nome} ao longo do tempo`,
    });
    desenhar($("#g-preco"), {
      series: [{ nome: "Preço de venda", pontos: amostrar(precos), estilo: "linha", cor: 1 }],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.num(v, 0)) },
      descricao: `Preço de venda do ${t.nome} ao longo do tempo`,
    });
    const notas = {
      pre: "Repare como o preço anda ao contrário da taxa: quando a taxa sobe, o preço cai. Mesmo assim ele converge para R$ 1.000 no vencimento.",
      ipca: "O preço sobe com a inflação mesmo quando a taxa fica parada. As quedas aparecem quando a taxa real sobe.",
      igpm: "O preço sobe com o IGP-M mesmo quando a taxa fica parada.",
      selic: "O Tesouro Selic quase não oscila: o preço sobe todo dia com a Selic. Por isso serve para a reserva de emergência.",
    };
    $("#detalhe-nota").textContent = notas[t.indexador];
  }

  tabela();
  detalhe();
  REDESENHAR.hoje = detalhe;
}

// ---------- CURVA ----------

const NOMES_CODIGO = { LTN: "Prefixado", "NTN-F": "Prefixado c/ juros", "NTN-B Principal": "IPCA+", "NTN-B": "IPCA+ c/ juros" };

function pontosCurva(lista) {
  return lista
    .map(([, dur, taxa, codigo, venc]) => [dur, taxa, `${NOMES_CODIGO[codigo]} ${venc.slice(0, 4)}`])
    .sort((a, b) => a[0] - b[0]);
}

/** Inflacao implicita por prazo numa curva: zero pre (LTN) contra zero real (IPCA+ sem cupom). */
function implicita(curva) {
  const zero = (codigo, lista) => lista.filter((p) => p[3] === codigo).map((p) => [p[0], p[2] / 100]).sort((a, b) => a[0] - b[0]);
  const pre = zero("LTN", curva.pre), real = zero("NTN-B Principal", curva.real);
  if (pre.length < 2 || real.length < 2) return [];
  const ini = Math.max(pre[0][0], real[0][0]), fim = Math.min(pre[pre.length - 1][0], real[real.length - 1][0]);
  const out = [];
  for (let a = Math.ceil(ini * 4) / 4; a <= fim + 1e-9; a += 0.25) {
    out.push([a, ((1 + P.interpolar(pre, a)) / (1 + P.interpolar(real, a)) - 1) * 100]);
  }
  return out;
}

async function iniciarCurva() {
  estado.curvas ??= await json("dados/curvas.json");
  const curvas = estado.curvas.curvas;
  const hoje = curvas[curvas.length - 1];
  let meses = 12;

  function maisProxima(alvoIso) {
    let melhor = curvas[0];
    for (const c of curvas) if (Math.abs(Date.parse(c.data) - Date.parse(alvoIso)) < Math.abs(Date.parse(melhor.data) - Date.parse(alvoIso))) melhor = c;
    return melhor;
  }

  botoesFiltro($("#comparar"), [[1, "1 mês atrás"], [6, "6 meses"], [12, "1 ano"], [24, "2 anos"], [60, "5 anos"], [120, "10 anos"]], meses, (v) => { meses = v; desenhe(); });

  function desenhe() {
    const antes = maisProxima(somarMeses(hoje.data, -meses));
    const rotHoje = `Hoje (${F.data(hoje.data)})`, rotAntes = `${F.data(antes.data)}`;
    const cfg = (campo, descricao) => ({
      series: [
        { nome: rotHoje, pontos: pontosCurva(hoje[campo]), estilo: "linha+pontos", cor: 1 },
        { nome: rotAntes, pontos: pontosCurva(antes[campo]), estilo: "linha+pontos", cor: 2, tracejado: true },
      ],
      x: { tipo: "numero", formato: (v) => `${F.num(v, v < 10 ? 1 : 0)} ${v === 1 ? "ano" : "anos"}` },
      y: { formato: (v) => `${F.num(v, 2)}%` },
      dica: "ponto",
      descricao,
      tabela: {
        colunas: ["Data", "Título", "Prazo médio (anos)", "Taxa (% a.a.)"],
        linhas: [hoje, antes].flatMap((c) => pontosCurva(c[campo]).map(([x, y, n]) => [F.data(c.data), n, F.num(x, 2), F.num(y, 2)])),
      },
    });
    desenhar($("#g-curva-pre"), cfg("pre", "Curva prefixada de hoje e da data comparada"));
    desenhar($("#g-curva-real"), cfg("real", "Curva real (IPCA+) de hoje e da data comparada"));
    desenhar($("#g-implicita"), {
      series: [
        { nome: rotHoje, pontos: implicita(hoje), estilo: "linha", cor: 1 },
        { nome: rotAntes, pontos: implicita(antes), estilo: "linha", cor: 2, tracejado: true },
      ],
      x: { tipo: "numero", formato: (v) => `${F.num(v, 1)} anos` },
      y: { formato: (v) => `${F.num(v, 2)}%` },
      descricao: "Inflação implícita por prazo, hoje e na data comparada",
    });
    const pre = pontosCurva(hoje.pre), preA = pontosCurva(antes.pre);
    const longo = pre[pre.length - 1], longoA = preA[preA.length - 1];
    $("#curva-nota").textContent = longo && longoA
      ? `O título prefixado mais longo paga hoje ${F.num(longo[1], 2)}% ao ano. Em ${F.data(antes.data)}, o mais longo pagava ${F.num(longoA[1], 2)}%. Cada ponto é um título; passe o mouse para ver qual. O eixo horizontal é o prazo médio dos pagamentos (duration), que deixa títulos com e sem cupom na mesma régua.`
      : "";
  }
  desenhe();
  REDESENHAR.curva = desenhe;
}

// ---------- E SE ----------

function iniciarEse() {
  const { resumo } = estado;
  const titulos = resumo.titulos.filter((t) => t.a_venda);
  const zero = P.curvasZero(resumo.titulos);
  const sel = $("#ese-titulo");
  opcoesAgrupadas(sel, titulos, (t) => `${t.nome.replace("Tesouro ", "")} · ${textoTaxa(t.indexador, t.taxa_compra)}`);
  const padrao = titulos.filter((t) => t.codigo === "LTN").sort((a, b) => b.du - a.du)[0] || titulos[0];
  sel.value = padrao.id;

  const campos = {
    valor: $("#ese-valor"), meses: $("#ese-meses"), choque: $("#ese-choque"),
    inflacao: $("#ese-inflacao"), selic: $("#ese-selic"),
  };
  const editado = { inflacao: false, selic: false };
  campos.inflacao.addEventListener("input", () => { editado.inflacao = true; });
  campos.selic.addEventListener("input", () => { editado.selic = true; });
  sel.addEventListener("change", () => { editado.inflacao = editado.selic = false; });

  function ler() {
    const t = titulos.find((x) => x.id === sel.value);
    const duFinal = t.fluxos[t.fluxos.length - 1][0];
    const maxMeses = Math.max(1, P.mesesAteVencimento(resumo.du_mes, duFinal));
    campos.meses.max = maxMeses;
    if (Number(campos.meses.value) > maxMeses) campos.meses.value = maxMeses;
    const meses = Number(campos.meses.value);
    const duH = P.duDoMes(resumo.du_mes, meses);
    const infCurva = P.inflacaoImplicita(zero, Math.max(duH, 21));
    const selicCurva = P.interpolar(zero.pre, Math.max(duH, 21));
    if (!editado.inflacao) campos.inflacao.value = (infCurva * 100).toFixed(1);
    if (!editado.selic) campos.selic.value = (selicCurva * 100).toFixed(1);
    $("#ese-inflacao-dica").textContent = `Na curva de hoje, a inflação implícita para esse prazo é ${F.pct(infCurva, 1)} ao ano.`;
    $("#ese-selic-dica").textContent = `A taxa prefixada para esse prazo, que embute a Selic esperada, é ${F.pct(selicCurva, 1)} ao ano.`;
    $("#ese-inflacao-campo").hidden = t.indexador !== "ipca" && t.indexador !== "igpm";
    $("#ese-selic-campo").hidden = t.indexador !== "selic";
    $("#ese-meses-txt").textContent = `${F.meses(meses)} (${F.mesAno(somarMeses(resumo.liquidacao, meses))})`;
    const choque = Number(campos.choque.value) / 100;
    $("#ese-choque-txt").textContent = choque === 0 ? "nenhuma" : F.pp(choque);
    return {
      t, maxMeses,
      op: {
        valor: Math.max(1, Number(campos.valor.value) || 0),
        meses, choque,
        inflacao: (Number(campos.inflacao.value) || 0) / 100,
        selic: (Number(campos.selic.value) || 0) / 100,
      },
    };
  }

  function atualizar() {
    const { t, maxMeses, op } = ler();
    const r = P.simular(t, resumo.du_mes, op);
    const r0 = P.simular(t, resumo.du_mes, { ...op, choque: 0 });
    const fim = P.simular(t, resumo.du_mes, { ...op, meses: maxMeses + 1 });
    const dataH = somarMeses(resumo.liquidacao, op.meses);
    const contratada = t.indexador === "pre" ? t.taxa_compra / 100
      : t.indexador === "selic" ? (1 + op.selic) * (1 + t.taxa_compra / 100) - 1
      : (1 + t.taxa_compra / 100) * (1 + op.inflacao) - 1;
    const tFinal = fim.duFinal / 252;
    const rentFim = tFinal > 0 ? Math.pow(fim.ateOFim / op.valor, 1 / tFinal) - 1 : 0;

    const ganho = r.total - op.valor;
    const movimento = op.choque > 0 ? `subirem ${F.pp(op.choque).replace("+", "")}` : op.choque < 0 ? `caírem ${F.pp(-op.choque).replace("+", "")}` : "não mudarem";
    const compara = r.rentabilidade < contratada - 0.0005 ? "menos do que" : r.rentabilidade > contratada + 0.0005 ? "mais do que" : "o mesmo que";
    const res = $("#ese-resultado");
    res.replaceChildren(
      h("div", { class: "heroi" },
        h("span", { class: "heroi-valor" }, F.brl(r.total)),
        h("span", { class: `heroi-delta ${ganho >= 0 ? "positivo" : "negativo"}` },
          `${ganho >= 0 ? "+" : "−"}${F.brl(Math.abs(ganho))} · ${F.pct(r.rentabilidade)} ao ano`)),
      h("p", { class: "frase" },
        "Comprando hoje por ", h("strong", {}, textoTaxa(t.indexador, t.taxa_compra)),
        ` e vendendo em ${F.mesAno(dataH)}, se os juros ${movimento}, você recebe `,
        h("strong", {}, F.brl(r.total)), ` (${F.pct(r.rentabilidade)} ao ano), `,
        h("strong", {}, compara), ` os ${F.pct(contratada)} ao ano que receberia segurando até o vencimento.`,
        r.recebido > 0 ? ` Inclui ${F.brl(r.recebido)} de ${t.codigo === "NTN-B1" ? "parcelas" : "cupons"} recebidos no caminho.` : ""),
      h("div", { class: "comparacoes" },
        tile("Se os juros não mudarem", F.brl(r0.total), `${F.pct(r0.rentabilidade)} ao ano`),
        tile(`Segurando até ${F.mesAno(t.vencimento)}`, F.brl(fim.ateOFim), `${F.pct(rentFim)} ao ano, sem risco de preço`),
        tile("Sensibilidade hoje", F.pctSinal(P.sensibilidade(t.fluxos, t.taxa_venda / 100, 0.01)),
          `no preço para cada +1 p.p. · prazo médio ${F.prazo(t.duration)}`),
      ),
    );

    // Grafico 1: total na data escolhida conforme o choque.
    const choques = [];
    for (let c = -5; c <= 5 + 1e-9; c += 0.25) choques.push([c, P.simular(t, resumo.du_mes, { ...op, choque: c / 100 }).total]);
    desenhar($("#g-ese-choque"), {
      series: [{ nome: `Valor em ${F.mesAno(dataH)}`, pontos: choques, estilo: "linha", cor: 1 }],
      x: { tipo: "numero", formato: (v) => (v === 0 ? "0" : `${v > 0 ? "+" : "−"}${F.num(Math.abs(v), Number.isInteger(v) ? 0 : 2)} p.p.`) },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.brlInteiro(v)) },
      refs: [{ eixo: "y", valor: op.valor, rotulo: "valor investido" }, { eixo: "x", valor: op.choque * 100, rotulo: "escolhido" }],
      descricao: "Valor recebido na data de venda para cada mudança dos juros",
    });

    // Grafico 2: caminho do valor ate o vencimento.
    const passo = maxMeses > 180 ? 3 : 1;
    const caminho = [], semMudanca = [];
    for (let m = 0; m <= maxMeses; m += passo) {
      const d = somarMeses(resumo.liquidacao, m);
      caminho.push([d, P.simular(t, resumo.du_mes, { ...op, meses: m }).total]);
      semMudanca.push([d, P.simular(t, resumo.du_mes, { ...op, meses: m, choque: 0 }).total]);
    }
    desenhar($("#g-ese-tempo"), {
      series: [
        { nome: op.choque === 0 ? "Juros sem mudança" : `Juros ${F.pp(op.choque)}`, pontos: caminho, estilo: "linha", cor: 1 },
        ...(op.choque === 0 ? [] : [{ nome: "Juros sem mudança", pontos: semMudanca, estilo: "linha", cor: 2, tracejado: true }]),
      ],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.brlInteiro(v)) },
      refs: [{ eixo: "y", valor: op.valor, rotulo: "valor investido" }, { eixo: "x", valor: dataH, rotulo: "venda" }],
      descricao: "Valor do investimento mês a mês até o vencimento",
    });
  }

  $("#form-ese").addEventListener("input", atualizar);
  $("#form-ese").addEventListener("submit", (ev) => ev.preventDefault());
  atualizar();
  REDESENHAR["e-se"] = atualizar;
}

// ---------- QUANTO RENDEU ----------

async function iniciarRendeu() {
  [estado.catalogo, estado.vna] = await Promise.all([
    estado.catalogo ?? json("dados/titulos.json"),
    estado.vna ?? json("dados/vna.json"),
  ]);
  const sel = $("#r-titulo");
  opcoesAgrupadas(sel, estado.catalogo, (t) => `${t.nome.replace("Tesouro ", "")}${t.vencido ? " (vencido)" : ""}`);
  const padrao = estado.catalogo.find((t) => t.id.startsWith("ipca-") && !t.vencido && t.inicio <= "2018-01-01") || estado.catalogo[0];
  sel.value = padrao.id;
  const compra = $("#r-compra"), venda = $("#r-venda");

  function datasPadrao() {
    const t = estado.catalogo.find((x) => x.id === sel.value);
    compra.min = venda.min = t.inicio;
    compra.max = t.fim;
    venda.max = t.vencido ? t.vencimento : t.fim;
    const tresAnos = somarMeses(estado.resumo.data, -36);
    compra.value = t.inicio > tresAnos ? t.inicio : (t.fim < tresAnos ? t.inicio : tresAnos);
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
    const r = R.rendeu(hist, estado.vna, {
      valor, compra: compra.value, venda: venda.value,
      custodia: (Number($("#r-custodia").value) || 0) / 100,
    });
    const res = $("#r-resultado");
    if (r.erro) { res.replaceChildren(h("p", { class: "erro" }, r.erro)); $("#g-rendeu").replaceChildren(); return; }

    const ganho = r.ganhoLiquido;
    const ajuste = r.dataCompra !== compra.value ? ` (o primeiro dia à venda a partir da data escolhida)` : "";
    res.replaceChildren(
      h("div", { class: "heroi" },
        h("span", { class: "heroi-valor" }, F.brl(r.liquido)),
        h("span", { class: `heroi-delta ${ganho >= 0 ? "positivo" : "negativo"}` },
          `${ganho >= 0 ? "+" : "−"}${F.brl(Math.abs(ganho))} líquidos · ${F.pct(r.tirLiquida)} ao ano`)),
      h("p", { class: "frase" },
        `Quem investiu ${F.brl(valor)} no ${t.nome} em ${F.data(r.dataCompra)}${ajuste} e ${r.carregou ? "segurou até o vencimento" : `vendeu em ${F.data(r.dataVenda)}`} ficou com `,
        h("strong", {}, F.brl(r.liquido)), " depois de impostos e custódia.",
        r.liquidoSelic !== null ? [" No mesmo período, o Tesouro Selic teria dado ", h("strong", {}, F.brl(r.liquidoSelic)), "."] : "",
        r.ipca !== null ? ` A inflação acumulada foi de ${F.pct(r.ipca - 1)}.` : ""),
      h("div", { class: "comparacoes" },
        tile("Rentabilidade líquida", `${F.pct(r.tirLiquida)} a.a.`, `em ${F.prazo(r.dias / 365)}`),
        r.liquidoSelic !== null ? tile("Tesouro Selic no período", F.brl(r.liquidoSelic), `Selic acumulada ${F.pct(r.selic - 1)} bruta`) : null,
        r.real !== null ? tile("Ganho real", F.pctSinal(r.real), "acima do IPCA, no período todo", r.real >= 0 ? "positivo" : "negativo") : null,
      ),
      h("table", { class: "decomposicao" }, h("tbody", {},
        linha("Valor investido", F.brl(valor)),
        linha(`${r.carregou ? "Principal recebido no vencimento" : "Venda ao Tesouro"} (bruto)`, F.brl(r.carregou ? r.pagamentos.at(-1)?.bruto ?? 0 : r.brutoVenda)),
        r.pagamentos.length > (r.carregou ? 1 : 0)
          ? linha(`${hist.tipo.includes("Renda+") || hist.tipo.includes("Educa+") ? "Parcelas" : "Cupons"} recebidos (${r.pagamentos.length - (r.carregou ? 1 : 0)}, bruto)`,
            F.brl(r.brutoPagamentos - (r.carregou ? r.pagamentos.at(-1).bruto : 0)))
          : null,
        linha("Imposto de renda", `−${F.brl(r.irVenda + r.irPagamentos)}`),
        r.iof > 0 ? linha("IOF", `−${F.brl(r.iof)}`) : null,
        linha("Taxa de custódia (estimada)", `−${F.brl(r.custodia)}`),
        h("tr", { class: "total" }, h("td", {}, "Líquido"), h("td", {}, F.brl(r.liquido))),
      )),
    );

    const posicao = R.serieDaPosicao(hist, r);
    const selic = [], ipca = [];
    for (const [d] of posicao) {
      const s = R.acumulado(estado.vna, "selic", r.dataCompra, d);
      const i = R.acumulado(estado.vna, "ipca", r.dataCompra, d);
      if (s) selic.push([d, valor * s]);
      if (i) ipca.push([d, valor * i]);
    }
    desenhar($("#g-rendeu"), {
      series: [
        { nome: "Seu investimento", pontos: amostrar(posicao), estilo: "linha", cor: 1 },
        { nome: "Mesmo valor no Tesouro Selic", pontos: amostrar(selic), estilo: "linha", cor: 2 },
        { nome: "Corrigido pela inflação (IPCA)", pontos: amostrar(ipca), estilo: "linha", cor: 3, tracejado: true },
      ],
      x: { tipo: "data", formato: F.data },
      y: { formato: (v, dica) => (dica ? F.brl(v) : F.brlInteiro(v)) },
      refs: [{ eixo: "y", valor, rotulo: "investido" }],
      descricao: "Valor bruto do investimento comparado com a Selic e a inflação",
    });
  }
  function linha(rotulo, valor) { return h("tr", {}, h("td", {}, rotulo), h("td", {}, valor)); }

  $("#form-rendeu").addEventListener("change", atualizar);
  $("#form-rendeu").addEventListener("input", (ev) => { if (ev.target.type === "number") atualizar(); });
  $("#form-rendeu").addEventListener("submit", (ev) => ev.preventDefault());
  await atualizar();
  REDESENHAR.rendeu = atualizar;
}

// ---------- COMO FUNCIONA ----------

function iniciarComo() {
  const t = estado.resumo.titulos.filter((x) => x.codigo === "LTN" && x.a_venda).sort((a, b) => b.du - a.du)[0];
  if (!t) return;
  const novo = t.pu_compra * (1 + P.sensibilidade(t.fluxos, t.taxa_compra / 100, 0.01));
  $("#exemplo-marcacao").textContent =
    `Exemplo com os dados de hoje: o ${t.nome} custa ${F.brl(t.pu_compra)} e paga R$ 1.000,00 em ${F.data(t.vencimento)}, o que dá ${F.taxa(t.taxa_compra)} ao ano. ` +
    `Se os juros subissem 1 ponto percentual amanhã, ele passaria a valer cerca de ${F.brl(novo)} (${F.pctSinal(novo / t.pu_compra - 1)}). ` +
    `Quem vendesse nesse dia perderia. Quem segurasse até ${t.vencimento.slice(0, 4)} continuaria recebendo os mesmos R$ 1.000,00.`;
}

// ---------- METODOLOGIA ----------

async function iniciarMetodologia() {
  const v = await json("dados/validacao.json");
  const tb = $("#tabela-validacao tbody");
  const linhas = Object.entries(v.por_tipo).sort((a, b) => ordemTipo(a[0]) - ordemTipo(b[0]));
  for (const [tipo, e] of linhas) {
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
      `Dias em que nenhum ajuste reproduz os preços do próprio arquivo oficial, deixados de fora da validação: ${v.dias_inconsistentes.map(F.data).join(", ")}.`));
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
  addEventListener("hashchange", () => {
    const antes = ultimaAba;
    const id = abaAtual();
    if (id !== antes) { mostrarAba(id); scrollTo({ top: 0 }); }
  });
  mostrarAba(abaAtual());
}

iniciar();
