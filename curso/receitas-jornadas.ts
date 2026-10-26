/** Catálogo versionado: unidade não depende das fotos privadas em saida/. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Nicho } from "./jornada";
import dados from "./receitas-jornadas.json";

const Receita = z.object({
  jornada: z.string().regex(/^[a-z0-9-]+$/), pessoa: z.string().min(1),
  cenas: z.array(z.object({ id: z.string(), mensagem: z.string().min(1), resposta: z.string(), resposta_observada: z.boolean().optional(), superficie: z.enum(["conversa", "nota", "passagem", "agenda", "negocio", "caso", "tarefa", "configuracao-externa", "fonte-externa"]) }).strict()),
}).strict();
export const receitas = z.array(Receita).parse(dados);
export type Receita = z.infer<typeof Receita>;
export type Historia = Nicho["jornadas"][number];
export const chaveDaCena = (jornada: string, cena: string) => `demo-${jornada}--historia--${cena}`;
export function lerHistorias() {
  const pasta = path.join(path.dirname(new URL(import.meta.url).pathname), "demonstracoes");
  return readdirSync(pasta).filter((f) => f.endsWith(".json")).sort()
    .flatMap((f) => Nicho.parse(JSON.parse(readFileSync(path.join(pasta, f), "utf8"))).jornadas);
}
/** Prefixo exclusivo, estável entre recapturas e independente da ordem de execução. */
export function idDaHistoria(jornada: string, entidade: number) {
  const n = receitas.findIndex((r) => r.jornada === jornada);
  if (n < 0) throw new Error("jornada sem receita");
  return `deca0000-0000-4000-8000-${String((n + 1) * 100 + entidade).padStart(12, "0")}`;
}
