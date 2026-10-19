// Safe math-expression compiler for function graphs (no eval). Variables: x (and y for inequalities). Supports implicit multiplication (2x, 3sin(x)).
type Tok = { k: "num"; v: number } | { k: "id"; v: string } | { k: "op"; v: string };

const FUNCS: Record<string, (n: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
  ln: Math.log, log: Math.log10, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  const s = src.toLowerCase().replace(/π/g, "pi").replace(/\*\*/g, "^").replace(/[\s]/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new Error(`Bad number at ${i}`);
      // "2e" must stay "2*e" when no exponent digits follow: the regex only eats a full exponent.
      out.push({ k: "num", v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/.test(c)) {
      const m = /^[a-z]+/.exec(s.slice(i))!;
      let word = m[0];
      // Split things like "xsin" greedily into known names: x, pi, e, or a function.
      while (word.length) {
        const name = [...Object.keys(FUNCS), ...Object.keys(CONSTS), "x", "y"].filter((n) => word.startsWith(n)).sort((a, b) => b.length - a.length)[0];
        if (!name) throw new Error(`Unknown name "${word}"`);
        out.push({ k: "id", v: name });
        word = word.slice(name.length);
        i += name.length;
      }
    } else if ("+-*/^(),".includes(c)) {
      out.push({ k: "op", v: c });
      i++;
    } else throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

type Node = (x: number, y: number) => number;

/** Compile an expression of x (and optionally y, used by inequalities). */
export function compile2(src: string): (x: number, y: number) => number {
  const toks = lex(src);
  if (!toks.length) throw new Error("Empty expression");
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && (peek() as { v: string }).v === v;

  const expr = (): Node => {
    let l = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      const a = l, b = term();
      l = op === "+" ? (x, y) => a(x, y) + b(x, y) : (x, y) => a(x, y) - b(x, y);
    }
    return l;
  };
  const startsFactor = (): boolean => {
    const t = peek();
    return !!t && (t.k === "num" || t.k === "id" || (t.k === "op" && t.v === "("));
  };
  const term = (): Node => {
    let l = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (toks[p++] as { v: string }).v;
        const a = l, b = unary();
        l = op === "*" ? (x, y) => a(x, y) * b(x, y) : (x, y) => a(x, y) / b(x, y);
      } else if (startsFactor()) {
        const a = l, b = unary(); // implicit multiplication
        l = (x, y) => a(x, y) * b(x, y);
      } else return l;
    }
  };
  const unary = (): Node => {
    if (isOp("-")) { p++; const a = unary(); return (x, y) => -a(x, y); }
    if (isOp("+")) { p++; return unary(); }
    return power();
  };
  const power = (): Node => {
    const base = atom();
    if (isOp("^")) { p++; const e = unary(); return (x, y) => Math.pow(base(x, y), e(x, y)); }
    return base;
  };
  const atom = (): Node => {
    const t = toks[p++];
    if (!t) throw new Error("Unexpected end");
    if (t.k === "num") { const v = t.v; return () => v; }
    if (t.k === "op" && t.v === "(") {
      const e = expr();
      if (!isOp(")")) throw new Error("Missing )");
      p++;
      return e;
    }
    if (t.k === "id") {
      if (t.v === "x") return (x) => x;
      if (t.v === "y") return (_x, y) => y;
      if (t.v in CONSTS) { const v = CONSTS[t.v]; return () => v; }
      const f = FUNCS[t.v];
      if (isOp("(")) {
        p++;
        const a = expr();
        if (!isOp(")")) throw new Error("Missing )");
        p++;
        return (x, y) => f(a(x, y));
      }
      // sin x^2 style: function applied to the following power-level factor
      const a = power();
      return (x, y) => f(a(x, y));
    }
    throw new Error(`Unexpected "${(t as { v: string }).v}"`);
  };

  const root = expr();
  if (p < toks.length) throw new Error(`Unexpected "${(toks[p] as { v: string }).v}"`);
  return root;
}

export function compile(src: string): (x: number) => number {
  const f = compile2(src);
  return (x) => f(x, 0);
}
