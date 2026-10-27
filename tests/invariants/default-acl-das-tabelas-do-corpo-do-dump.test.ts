import { describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

/**
 * AS TABELAS DO CORPO DO DUMP NASCEM COM O ACL DO SUPABASE — prova de suíte, não
 * sonda de shell (issue #887).
 *
 * ─── O que estava mentindo ──────────────────────────────────────────────────
 *
 * Todo projeto Supabase nasce com este `pg_default_acl` em `public` (medido em
 * 2026-10-26 no Supabase local desta máquina, `supabase/postgres:15.19.0.004`):
 *
 *     postgres | public | TABLES    | {postgres=arwdDxt, anon=arwdDxt,
 *                                     authenticated=arwdDxt, service_role=arwdDxt}
 *     postgres | public | SEQUENCES | {postgres=rwU, anon=rwU,
 *                                     authenticated=rwU, service_role=rwU}
 *     postgres | public | FUNCTIONS | {postgres=X, anon=X,
 *                                     authenticated=X, service_role=X}
 *
 * O `pg_dump` do `baseline.sql` reemite as três famílias em `~:4762-4785`,
 * DEPOIS do corpo do dump. No cliente, a tabela do corpo nasce com o ACL porque
 * o bootstrap do Supabase já gravou a entrada antes de qualquer SQL nosso; num
 * Postgres cru ela nasceria só com o `GRANT` enumerado que o dump emite — e esse
 * `GRANT` omite privilégio em quatro tabelas:
 *
 *     api_audit_log        anon/authenticated/service_role sem UPDATE, DELETE
 *     crm_lead_activities  anon/authenticated sem UPDATE, DELETE
 *     event_log            anon/authenticated sem INSERT, UPDATE, DELETE
 *     webhook_events_log   anon/authenticated sem INSERT, UPDATE, DELETE
 *
 * Sem o prelude de `scripts/test-db.sh` reproduzindo o default ACL, essas quatro
 * nasciam MAIS FECHADAS que no cliente, e todo invariante do tipo "o papel X não
 * tem o privilégio Y na tabela Z" sobre elas passava sem provar nada. Foi assim
 * que o `service_role` apagava e reescrevia linha de `api_audit_log` com o gate
 * verde, até a migration 0258.
 *
 * ─── Por que ESTE arquivo, se o prelude já foi consertado ───────────────────
 *
 * Porque o conserto tinha prova de shell: uma sonda em `scripts/test-db.sh` que
 * cria uma tabela antes do baseline e derruba o run inteiro. Ela é boa — aborta
 * com o motivo escrito — e continua sendo a única que mede o instante certo:
 * DEPOIS do baseline a entrada em `pg_default_acl` existe de qualquer jeito,
 * porque o próprio dump a grava, e qualquer asserção ali seria verde por
 * construção. O que faltava é o que só uma asserção de suíte dá: arquivo e
 * tabela nomeados no vermelho, o conjunto de privilégios comparado como
 * conjunto, e a negativa no mesmo lugar que a positiva.
 *
 * ─── Quais letras discriminam, e como isso foi medido ───────────────────────
 *
 * NÃO são as sete. Sabotagem medida em 2026-10-27: trocar as três linhas
 * `grant all on tables` do prelude por `grant select, insert, update, delete`
 * deixa o run VERDE — porque o `GRANT` enumerado do dump já entrega
 * `REFERENCES`, `TRIGGER` e `TRUNCATE` nessas tabelas, e a sonda de shell mede
 * DELETE, que continua lá. Ou seja, a "concessão parcial" que o PR #1063 listou
 * como risco não é alcançável nestas tabelas: o buraco é exatamente
 * INSERT, UPDATE e DELETE, as três que nenhum `GRANT` do dump enumera.
 *
 * `service_role` também não está exposto nesta classe, e pelo mesmo motivo: o
 * dump lhe concede `GRANT ALL` explícito nas três. O verde falso era de `anon` e
 * `authenticated` — por isso a comparação é por papel, e não uma vez por tabela.
 *
 * A comparação do conjunto INTEIRO fica, então, como registro da régua do
 * produto (e como guarda do dia em que uma tabela do corpo tiver `GRANT`
 * enumerado mais pobre), não como o que reprova hoje. A sabotagem que reprova
 * hoje é a que remove as três linhas `on tables`: 6 casos de 9 e o caso do
 * núcleo — medido.
 *
 * ─── A armadilha que este arquivo NÃO repete ────────────────────────────────
 *
 * A primeira versão media tudo com uma chamada só:
 *
 *     has_table_privilege('anon', 'public.api_audit_log', 'SELECT,UPDATE')
 *
 * e ela devolve **true** mesmo com o UPDATE revogado — a lista separada por
 * vírgula é "tem QUALQUER um", não "tem todos" (medido neste banco:
 * `has_table_privilege('anon','public.api_audit_log','UPDATE')` = false e a
 * mesma chamada com `'SELECT,UPDATE'` = true). Um invariante escrito assim
 * aprovaria qualquer tabela que o papel consiga apenas LER, que é o caso de
 * quase todas — verde por construção, de novo, dentro do teste que existe para
 * pegar verde por construção. Por isso aqui cada privilégio é perguntado
 * sozinho, e o resultado é comparado como CONJUNTO.
 *
 * ─── O que a matriz do CI ensinou (pg17) ───────────────────────────────────
 *
 * O primeiro push reprovou em `invariants-majors (17)`: no pg17 `grant all`
 * concede `MAINTAIN` (`m`) além das sete letras, e o conjunto DIRETO saía com
 * oito contra uma régua de sete. O caso reprovava por MAJOR, não por ACL — dois
 * bancos fiéis, um veredito. O conjunto direto passou a ser lido só no universo
 * das sete, que é o que existe nas duas majors (`m` só existe no pg17, e o
 * mesmo `grant all` do prelude o reproduz lá).
 *
 * ─── Como mede ─────────────────────────────────────────────────────────────
 *
 * Depois do baseline, o que ainda distingue o banco fiel do fictício são as
 * tabelas do CORPO: as do apêndice nascem depois do `ALTER DEFAULT PRIVILEGES`
 * do dump e ficam certas nos dois mundos. A régua é o banco do PRODUTO — os
 * conjuntos abaixo foram lidos de `supabase_db_deskcomm-crm` (stack local do
 * Supabase com este schema), não deduzidos do texto do baseline.
 */

const PAPEIS = ["anon", "authenticated", "service_role"] as const;

/** As sete letras de tabela que `grant all` concede — a ordem do `string_agg`. */
const ACL_INTEIRO = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"] as const;

/**
 * A régua por tabela e papel, lida do banco do produto.
 *
 * `ACL_INTEIRO`: a tabela do corpo nasceu com o default ACL e nenhum `REVOKE`
 * posterior a fechou — é o conjunto em que o gate ficava verde por construção.
 * `api_audit_log` e `idempotency_keys` vêm de `REVOKE` explícito do baseline
 * (`:4597` e `:4676`) e servem de controle: provam que o instrumento enxerga
 * negação e distingue papel por papel.
 */
const REGUA: Record<string, Record<(typeof PAPEIS)[number], readonly string[]>> = {
  crm_lead_activities: {
    anon: ACL_INTEIRO,
    authenticated: ACL_INTEIRO,
    service_role: ACL_INTEIRO,
  },
  event_log: {
    anon: ACL_INTEIRO,
    authenticated: ACL_INTEIRO,
    service_role: ACL_INTEIRO,
  },
  webhook_events_log: {
    anon: ACL_INTEIRO,
    authenticated: ACL_INTEIRO,
    service_role: ACL_INTEIRO,
  },
  api_audit_log: {
    anon: ["INSERT", "REFERENCES", "SELECT", "TRIGGER"],
    authenticated: ["INSERT", "REFERENCES", "SELECT", "TRIGGER"],
    service_role: ["INSERT", "REFERENCES", "SELECT", "TRIGGER"],
  },
  idempotency_keys: {
    anon: ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"],
    authenticated: ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"],
    service_role: ACL_INTEIRO,
  },
};

const MARCA = "SONDA|";

/** Linhas de uma consulta de sonda, sem os ecos do psql (SELECT, BEGIN…). */
function sondas(corpo: string): string[] {
  return sql(corpo)
    .split("\n")
    .filter((linha) => linha.startsWith(MARCA))
    .map((linha) => linha.slice(MARCA.length));
}

/**
 * Por (tabela, papel): o conjunto de privilégios DIRETOS (`aclexplode`, sem
 * `is_grantable`) e o EFETIVO (`has_table_privilege` perguntado privilégio por
 * privilégio). Os dois, e não um: o direto é o que o default ACL escreve; o
 * efetivo é o que a sessão do papel realmente consegue, e é onde apareceria uma
 * herança de PUBLIC que o direto não mostra.
 */
function acls(tabela: string, papel: string): { diretos: string[]; efetivos: string[] } {
  const lista = ACL_INTEIRO.map((p) => `'${p}'`).join(",");
  const linhas = sondas(`
    with t as (select 'public.${tabela}'::regclass::oid as oid),
    p(privilegio) as (select unnest(array[${lista}]::text[]))
    select '${MARCA}'
        || coalesce((select string_agg(distinct a.privilege_type, ',' order by a.privilege_type)
                       from pg_class c, aclexplode(c.relacl) a
                      where c.oid = t.oid and a.grantee = '${papel}'::regrole
                        and not a.is_grantable
                        -- Só o universo das sete: o pg17 acrescenta MAINTAIN (m)
                        -- ao grant all, e ele não existe no pg15. Comparar sem
                        -- filtrar faria o caso reprovar por MAJOR, não por ACL —
                        -- dois bancos fiéis, um veredito. O m está reproduzido
                        -- pelo mesmo grant all do prelude nas duas majors.
                        and a.privilege_type = any (array[${lista}]::text[])), '-')
        || '|'
        || coalesce((select string_agg(p.privilegio, ',' order by p.privilegio)
                       from p
                      where has_table_privilege('${papel}'::regrole, t.oid, p.privilegio)), '-')
      from t;
  `);
  if (linhas.length !== 1) throw new Error(`sonda de ${tabela}/${papel}: esperava 1 linha, veio ${linhas.length}`);
  const linha = linhas[0];
  if (linha === undefined) throw new Error(`sonda de ${tabela}/${papel}: linha vazia`);
  const [diretos = "-", efetivos = "-"] = linha.split("|");
  return {
    diretos: diretos === "-" ? [] : diretos.split(","),
    efetivos: efetivos === "-" ? [] : efetivos.split(","),
  };
}

const CASOS = Object.entries(REGUA).flatMap(([tabela, porPapel]) =>
  Object.entries(porPapel).map(([papel, esperado]) => ({ tabela, papel, esperado })),
);

describe("default ACL das tabelas do corpo do dump (#887)", () => {
  it("as cinco tabelas medidas existem no banco do gate, e os papéis também", () => {
    // Sem esta guarda, um rename no baseline deixaria os casos seguintes sem
    // linha nenhuma para comparar — e um laço vazio não reprova nada.
    const marcadores = sondas(
      Object.keys(REGUA).map((t) => `select '${MARCA}tabela:${t}';`).join("\n") +
        "\n" +
        PAPEIS.map((p) => `select '${MARCA}papel:${p}';`).join("\n"),
    );
    for (const tabela of Object.keys(REGUA)) {
      expect(marcadores, `tabela ausente no gate: ${tabela}`).toContain(`tabela:${tabela}`);
    }
    for (const papel of PAPEIS) {
      expect(marcadores, `papel ausente no gate: ${papel}`).toContain(`papel:${papel}`);
    }
    expect(CASOS.length).toBe(Object.keys(REGUA).length * PAPEIS.length);
  });

  it.each(CASOS)(
    "$tabela / $papel: o ACL é o do produto, por grant direto e efetivo",
    ({ tabela, papel, esperado }) => {
      const { diretos, efetivos } = acls(tabela, papel);
      expect(diretos, `${tabela} / ${papel}: grants DIRETOS fora da régua do produto`).toEqual([...esperado]);
      expect(efetivos, `${tabela} / ${papel}: privilégios EFETIVOS fora da régua do produto`).toEqual([...esperado]);
    },
  );

  it("o núcleo do #887: as três tabelas do corpo entregam INSERT, UPDATE e DELETE aos três papéis", () => {
    // Isolado em um caso próprio porque é A classe que a issue nomeia: é destes
    // três privilégios que o `GRANT` enumerado do dump abre mão, e é sobre eles
    // que "o papel X não pode Y" passava sem prova. Se o prelude perder as três
    // linhas `on tables`, é este caso que reprova primeiro, com o nome da tabela.
    for (const tabela of ["crm_lead_activities", "event_log", "webhook_events_log"] as const) {
      for (const papel of PAPEIS) {
        const { diretos, efetivos } = acls(tabela, papel);
        for (const privilegio of ["INSERT", "UPDATE", "DELETE"] as const) {
          expect(diretos, `${tabela} / ${papel}: sem ${privilegio} DIRETO`).toContain(privilegio);
          expect(efetivos, `${tabela} / ${papel}: sem ${privilegio} EFETIVO`).toContain(privilegio);
        }
      }
    }
  });

  it("CONTROLE: o audit log perde UPDATE, DELETE e TRUNCATE nos três papéis (migration 0258)", () => {
    for (const papel of PAPEIS) {
      const { diretos } = acls("api_audit_log", papel);
      for (const privilegio of ["UPDATE", "DELETE", "TRUNCATE"]) {
        expect(diretos, `api_audit_log / ${papel}: ${privilegio} voltou — a 0258 foi furada`).not.toContain(privilegio);
      }
    }
  });

  it("CONTROLE: o TRUNCATE de idempotency_keys difere entre anon e service_role", () => {
    // Mesma tabela, mesmo privilégio, veredito diferente por papel: prova que a
    // sonda não devolve o mesmo conjunto para os três.
    expect(acls("idempotency_keys", "anon").diretos, "idempotency_keys / anon: TRUNCATE deveria estar revogado").not.toContain(
      "TRUNCATE",
    );
    expect(
      acls("idempotency_keys", "authenticated").diretos,
      "idempotency_keys / authenticated: TRUNCATE deveria estar revogado",
    ).not.toContain("TRUNCATE");
    expect(
      acls("idempotency_keys", "service_role").diretos,
      "idempotency_keys / service_role: TRUNCATE deveria continuar concedido",
    ).toContain("TRUNCATE");
  });
});
