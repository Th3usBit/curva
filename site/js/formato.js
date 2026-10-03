// Numeros e datas no formato brasileiro.

const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const reaisInteiros = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const numero = (casas) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const cache = new Map();
const fmt = (casas) => (cache.has(casas) ? cache.get(casas) : cache.set(casas, numero(casas)).get(casas));

export const brl = (v) => (Number.isFinite(v) ? reais.format(v) : "—");
export const brlInteiro = (v) => (Number.isFinite(v) ? reaisInteiros.format(v) : "—");
export const num = (v, casas = 2) => (Number.isFinite(v) ? fmt(casas).format(v) : "—");

/** Fracao como porcentagem: 0.1234 -> "12,34%". */
export const pct = (v, casas = 2) => (Number.isFinite(v) ? `${fmt(casas).format(v * 100).replace("-", "−")}%` : "—");

/** Porcentagem com sinal: 0.05 -> "+5,00%". */
export const pctSinal = (v, casas = 2) =>
  (Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(casas).format(Math.abs(v) * 100)}%` : "—");

/** Taxa ja em % (como no arquivo do Tesouro): 13.37 -> "13,37%". */
export const taxa = (v) => (Number.isFinite(v) ? `${fmt(2).format(v)}%` : "—");

/** Pontos percentuais com sinal: 0.01 -> "+1,00 p.p.". */
export const pp = (v, casas = 2) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt(casas).format(Math.abs(v) * 100)} p.p.`;

/** "2026-10-02" -> "02/10/2026". */
export const data = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-10-02" -> "out/2026". */
export const mesAno = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

/** Prazo em anos legivel: 0.5 -> "6 meses", 2.25 -> "2,3 anos". */
export function prazo(anos) {
  if (!Number.isFinite(anos)) return "—";
  if (anos < 1) {
    const m = Math.max(1, Math.round(anos * 12));
    return `${m} ${m === 1 ? "mês" : "meses"}`;
  }
  return `${fmt(1).format(anos)} ${anos < 2 && anos.toFixed(1) === "1.0" ? "ano" : "anos"}`;
}

/** Meses como texto: 18 -> "1 ano e 6 meses". */
export function meses(m) {
  const a = Math.floor(m / 12), r = m % 12;
  const pa = a ? `${a} ${a === 1 ? "ano" : "anos"}` : "";
  const pm = r ? `${r} ${r === 1 ? "mês" : "meses"}` : "";
  return [pa, pm].filter(Boolean).join(" e ") || "0 meses";
}
