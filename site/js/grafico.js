// Grafico de linhas e pontos em SVG, sem dependencias.
//
//   desenhar(el, {
//     series: [{ nome, pontos: [[x, y, rotulo?], ...], estilo: "linha" | "pontos", cor: 1..3 }],
//     x: { tipo: "data" | "numero", formato },   // datas como ISO "aaaa-mm-dd"
//     y: { formato, zero },                       // zero: incluir o 0 no eixo
//     refs: [{ eixo: "x" | "y", valor, rotulo }], // linhas de referencia
//     dica: "x" | "ponto",                        // cursor por data (todas as series) ou ponto mais proximo
//     tabela: { colunas, linhas },                // tabela acessivel com os mesmos dados
//     descricao,                                  // texto para leitores de tela
//   })
//
// Cores, fontes e grade vem do CSS (--s1..--s3, --grade, --tinta-*); o modo
// escuro troca so as variaveis. Rotulos entram por textContent, nunca HTML.

const NS = "http://www.w3.org/2000/svg";
const MARGEM = { topo: 12, dir: 16, base: 30, esq: 58 };

function el(tag, attrs = {}, pai) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (pai) pai.appendChild(e);
  return e;
}

const paraNumero = (tipo, v) => (tipo === "data" ? Date.parse(v) : v);

/** Ticks "redondos" (1, 2, 2,5 ou 5 x 10^k) cobrindo [min, max]. */
export function ticks(min, max, alvo = 5) {
  if (!(max > min)) return [min];
  const passoBruto = (max - min) / alvo;
  const mag = Math.pow(10, Math.floor(Math.log10(passoBruto)));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passoBruto);
  const out = [];
  for (let v = Math.ceil(min / passo) * passo; v <= max + passo * 1e-9; v += passo) out.push(+v.toPrecision(12));
  return out;
}

/** Ticks de data: anos, ou meses quando o intervalo e curto. */
export function ticksData(min, max, largura) {
  const anos = (max - min) / (365.25 * 86400000);
  const cabem = Math.max(2, Math.floor(largura / 70));
  const out = [];
  if (anos > 2) {
    const passo = [1, 2, 5, 10].find((p) => anos / p <= cabem) || 10;
    const a0 = new Date(min).getUTCFullYear();
    for (let a = Math.ceil(a0 / passo) * passo; ; a += passo) {
      const t = Date.UTC(a, 0, 1);
      if (t > max) break;
      if (t >= min) out.push(t);
    }
  } else {
    const meses = anos * 12;
    const passo = [1, 2, 3, 6, 12].find((p) => meses / p <= cabem) || 12;
    const d = new Date(min);
    let m = d.getUTCFullYear() * 12 + d.getUTCMonth() + 1;
    m = Math.ceil(m / passo) * passo;
    for (; ; m += passo) {
      const t = Date.UTC(Math.floor(m / 12), m % 12, 1);
      if (t > max) break;
      out.push(t);
    }
  }
  return out;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function rotuloData(t, curto) {
  const d = new Date(t);
  return curto ? `${MESES[d.getUTCMonth()]}/${String(d.getUTCFullYear()).slice(2)}` : String(d.getUTCFullYear());
}

function isoDe(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function desenhar(alvo, cfg) {
  alvo.replaceChildren();
  alvo.classList.add("grafico");
  const series = cfg.series.filter((s) => s.pontos.length);

  if (series.length > 1) {
    const leg = document.createElement("ul");
    leg.className = "legenda";
    for (const s of series) {
      const li = document.createElement("li");
      const chave = document.createElement("span");
      chave.className = `chave ${s.estilo === "pontos" ? "chave-ponto" : "chave-linha"}${s.tracejado ? " tracejada" : ""}`;
      chave.style.setProperty("--cor", `var(--s${s.cor})`);
      li.append(chave, document.createTextNode(s.nome));
      leg.appendChild(li);
    }
    alvo.appendChild(leg);
  }

  const caixa = document.createElement("div");
  caixa.className = "area";
  alvo.appendChild(caixa);
  const dica = document.createElement("div");
  dica.className = "dica";
  dica.hidden = true;
  caixa.appendChild(dica);

  if (cfg.tabela) alvo.appendChild(tabela(cfg.tabela));

  if (!series.length) {
    const vazio = document.createElement("p");
    vazio.className = "vazio";
    vazio.textContent = "Sem dados para este período.";
    caixa.appendChild(vazio);
    return;
  }

  const render = () => plotar(caixa, dica, series, cfg);
  render();
  let largura = caixa.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(caixa.clientWidth - largura) > 4) {
      largura = caixa.clientWidth;
      render();
    }
  });
  ro.observe(caixa);
}

function plotar(caixa, dica, series, cfg) {
  caixa.querySelector("svg")?.remove();
  const W = Math.max(280, caixa.clientWidth);
  const H = cfg.altura || Math.round(Math.min(360, Math.max(220, W * 0.5)));
  const tx = cfg.x.tipo;
  const pts = series.map((s) => s.pontos.map((p) => [paraNumero(tx, p[0]), p[1], p[2]]));

  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const lista of pts) for (const [x, y] of lista) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
  }
  for (const r of cfg.refs || []) {
    if (r.eixo === "y") { ymin = Math.min(ymin, r.valor); ymax = Math.max(ymax, r.valor); }
  }
  if (cfg.y.zero) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
  if (cfg.x.min !== undefined) xmin = paraNumero(tx, cfg.x.min);
  if (cfg.x.max !== undefined) xmax = paraNumero(tx, cfg.x.max);
  if (xmin === xmax) { xmin -= 1; xmax += 1; }
  const folga = (ymax - ymin) * 0.08 || Math.abs(ymax) * 0.05 || 1;
  ymin -= folga; ymax += folga;
  const yt = ticks(ymin, ymax, Math.max(3, Math.round(H / 60)));
  ymin = Math.min(ymin, yt[0]); ymax = Math.max(ymax, yt[yt.length - 1]);

  const esq = MARGEM.esq, dir = W - MARGEM.dir, topo = MARGEM.topo, base = H - MARGEM.base;
  const sx = (x) => esq + (x - xmin) / (xmax - xmin) * (dir - esq);
  const sy = (y) => base - (y - ymin) / (ymax - ymin) * (base - topo);

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
  if (cfg.descricao) el("title", {}, svg).textContent = cfg.descricao;

  const grade = el("g", { class: "eixos" }, svg);
  for (const v of yt) {
    el("line", { x1: esq, x2: dir, y1: sy(v), y2: sy(v), class: "grade" }, grade);
    el("text", { x: esq - 8, y: sy(v), class: "tick", "text-anchor": "end", "dominant-baseline": "middle" }, grade)
      .textContent = cfg.y.formato(v);
  }
  const xt = tx === "data" ? ticksData(xmin, xmax, dir - esq) : ticks(xmin, xmax, Math.max(3, Math.floor((dir - esq) / 80)));
  const curto = tx === "data" && (xmax - xmin) / (365.25 * 86400000) <= 2;
  for (const v of xt) {
    if (v < xmin || v > xmax) continue;
    el("text", { x: sx(v), y: base + 18, class: "tick", "text-anchor": "middle" }, grade)
      .textContent = tx === "data" ? rotuloData(v, curto) : cfg.x.formato(v);
  }
  el("line", { x1: esq, x2: dir, y1: base, y2: base, class: "eixo" }, grade);

  for (const r of cfg.refs || []) {
    const g = el("g", { class: "ref" }, svg);
    if (r.eixo === "y") {
      el("line", { x1: esq, x2: dir, y1: sy(r.valor), y2: sy(r.valor) }, g);
      if (r.rotulo) el("text", { x: dir - 4, y: sy(r.valor) - 6, "text-anchor": "end" }, g).textContent = r.rotulo;
    } else {
      const x = sx(paraNumero(tx, r.valor));
      el("line", { x1: x, x2: x, y1: topo, y2: base }, g);
      if (r.rotulo) el("text", { x: x + 4, y: topo + 10 }, g).textContent = r.rotulo;
    }
  }

  series.forEach((s, i) => {
    const g = el("g", { class: "serie", style: `--cor: var(--s${s.cor})` }, svg);
    const lista = pts[i];
    if (s.estilo !== "pontos") {
      let d = "";
      lista.forEach(([x, y], k) => { d += `${k ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`; });
      el("path", { d, class: `linha${s.tracejado ? " tracejada" : ""}` }, g);
    }
    if (s.estilo === "pontos" || s.estilo === "linha+pontos") {
      for (const [x, y] of lista) el("circle", { cx: sx(x), cy: sy(y), r: 4.5, class: "ponto" }, g);
    }
  });

  const cursor = el("g", { class: "cursor", visibility: "hidden" }, svg);
  const linhaCursor = el("line", { y1: topo, y2: base }, cursor);
  const marcas = series.map((s) => el("circle", { r: 5, class: "marca", style: `--cor: var(--s${s.cor})` }, cursor));

  const capt = el("rect", { x: esq, y: topo, width: dir - esq, height: base - topo, class: "captura", tabindex: 0 }, svg);
  caixa.insertBefore(svg, dica);

  const fmtX = (x) => (tx === "data" ? cfg.x.formato(isoDe(x)) : cfg.x.formato(x));

  function mostrar(px, py) {
    const linhas = [];
    let cx = null;
    if ((cfg.dica || "x") === "x") {
      // Cursor por X: o ponto mais proximo em x da serie mais longa define a data.
      const xv = xmin + (px - esq) / (dir - esq) * (xmax - xmin);
      series.forEach((s, i) => {
        const lista = pts[i];
        let lo = 0, hi = lista.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (lista[m][0] <= xv) lo = m; else hi = m; }
        const p = Math.abs(lista[lo][0] - xv) <= Math.abs(lista[hi][0] - xv) ? lista[lo] : lista[hi];
        if (cx === null || Math.abs(p[0] - xv) < Math.abs(cx - xv)) cx = p[0];
        linhas.push({ s, p, i });
      });
      marcas.forEach((m, i) => {
        const l = linhas[i];
        const perto = Math.abs(l.p[0] - cx) <= (xmax - xmin) * 0.02;
        m.setAttribute("visibility", perto ? "visible" : "hidden");
        m.setAttribute("cx", sx(l.p[0])); m.setAttribute("cy", sy(l.p[1]));
      });
    } else {
      // Ponto mais proximo em distancia de tela, entre todas as series.
      let melhor = null;
      series.forEach((s, i) => pts[i].forEach((p) => {
        const d = Math.hypot(sx(p[0]) - px, sy(p[1]) - py);
        if (!melhor || d < melhor.d) melhor = { d, s, p, i };
      }));
      if (!melhor || melhor.d > 40) { esconder(); return; }
      cx = melhor.p[0];
      linhas.push(melhor);
      marcas.forEach((m, i) => {
        m.setAttribute("visibility", i === melhor.i ? "visible" : "hidden");
        m.setAttribute("cx", sx(melhor.p[0])); m.setAttribute("cy", sy(melhor.p[1]));
      });
    }
    linhaCursor.setAttribute("x1", sx(cx)); linhaCursor.setAttribute("x2", sx(cx));
    cursor.setAttribute("visibility", "visible");

    dica.replaceChildren();
    const cab = document.createElement("div");
    cab.className = "dica-x";
    cab.textContent = linhas.length === 1 && linhas[0].p[2] ? `${linhas[0].p[2]} · ${fmtX(linhas[0].p[0])}` : fmtX(cx);
    dica.appendChild(cab);
    for (const { s, p } of linhas) {
      const row = document.createElement("div");
      row.className = "dica-linha";
      const chave = document.createElement("span");
      chave.className = "chave chave-linha";
      chave.style.setProperty("--cor", `var(--s${s.cor})`);
      const v = document.createElement("strong");
      v.textContent = cfg.y.formato(p[1], true);
      const n = document.createElement("span");
      n.textContent = s.nome;
      row.append(chave, v, n);
      dica.appendChild(row);
    }
    dica.hidden = false;
    const w = dica.offsetWidth;
    const left = sx(cx) + 14 + w > W ? sx(cx) - 14 - w : sx(cx) + 14;
    dica.style.left = `${Math.max(0, left)}px`;
    dica.style.top = `${topo + 4}px`;
  }
  function esconder() {
    cursor.setAttribute("visibility", "hidden");
    dica.hidden = true;
  }
  const ponto = (ev) => {
    const r = svg.getBoundingClientRect();
    return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
  };
  capt.addEventListener("pointermove", (ev) => mostrar(...ponto(ev)));
  capt.addEventListener("pointerdown", (ev) => mostrar(...ponto(ev)));
  capt.addEventListener("pointerleave", esconder);
  // Teclado: setas percorrem o eixo X.
  let kx = null;
  capt.addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    kx = kx === null ? dir : Math.min(dir, Math.max(esq, kx + (ev.key === "ArrowRight" ? 1 : -1) * (dir - esq) / 60));
    mostrar(kx, (topo + base) / 2);
  });
  capt.addEventListener("blur", esconder);
}

function tabela({ colunas, linhas, titulo = "Ver os dados em tabela" }) {
  const det = document.createElement("details");
  det.className = "dados";
  const sum = document.createElement("summary");
  sum.textContent = titulo;
  det.appendChild(sum);
  const rolagem = document.createElement("div");
  rolagem.className = "rolagem";
  const t = document.createElement("table");
  const thead = t.createTHead().insertRow();
  for (const c of colunas) {
    const th = document.createElement("th");
    th.textContent = c;
    thead.appendChild(th);
  }
  const tb = t.createTBody();
  for (const l of linhas) {
    const tr = tb.insertRow();
    for (const v of l) tr.insertCell().textContent = v;
  }
  rolagem.appendChild(t);
  det.appendChild(rolagem);
  return det;
}
