/**
 * O DOMÍNIO DE ENVIO DA ORGANIZAÇÃO (#3441, fatia do domínio).
 *
 * ─── O que esta peça resolve ─────────────────────────────────────────────────
 *
 * A conta Resend da organização já existe (#3287, `lib/email/resend-da-organizacao.ts`):
 * a chave cifrada e o endereço de remetente. O que faltava é o DOMÍNIO — o que o
 * mundo precisa ver no DNS para aceitar em volume o e-mail que sai por ele, e que
 * é o que o Gmail e o Yahoo passaram a exigir de quem manda e-mail em massa:
 *
 *   - SPF no subdomínio de envio (`send.<domínio>`) — diz QUEM pode entregar;
 *   - DKIM (`resend._domainkey.<domínio>`) — diz que a mensagem não foi trocada;
 *   - MX no subdomínio de envio — é por onde as VOLTAS chegam ao provedor, e
 *     sem elas a lista de supressão fica cega;
 *   - DMARC (`_dmarc.<domínio>`) — diz o que fazer quando os dois acima divergem.
 *
 * ─── Por que MEDIR PELO DNS, e não só pelos registros da API do provedor ─────
 *
 * A API de domínios da Resend devolve o que ELA pediu para publicar. Isso é útil
 * para mostrar a tabela de registros, e é o que `verificarDominioNaResend`
 * (`resend-da-organizacao.ts`) já usa no conectar. Mas quem decide se o e-mail
 * entra na caixa do destinatário é o DNS público — o registro pode estar pedido
 * e não publicado, publicado no domínio errado, com dois SPF (o que a RFC 7208
 * §3.2 manda tratar como PERMERROR) ou com a chave DKIM revogada (`p=` vazio).
 * Nenhum desses casos aparece no `status` do painel. E o DMARC, que a issue manda
 * "orientar e conferir por DNS", não existe na API da Resend como conferência.
 *
 * Esta peça é a CONFERÊNCIA: recebe as respostas de DNS já coletadas (a coleta é
 * `dominio-de-envio-dns.ts`, com resolvedor injetável) e devolve um diagnóstico
 * com uma linha por registro, os bloqueios, os avisos e o veredito único
 * `prontoParaEnviar`. Função PURA: sem banco, sem rede, sem relógio próprio.
 *
 * ─── O que este arquivo NÃO faz ──────────────────────────────────────────────
 *
 * Não cria domínio na conta da Resend nem pede verificação — isso é chamada de
 * API com a chave da organização, e mora em `dominio-de-envio-resend.ts`. Aqui
 * não passa segredo nenhum: a saída é feita para ir para a tela, e nada dela
 * volta para o banco.
 */

/** As quatro perguntas que o DNS responde sobre um domínio de envio. */
export type TipoDeRegistro = "spf" | "dkim" | "mx" | "dmarc";

/**
 * O estado de UM registro.
 *
 * - `ok` — publicado e utilizável.
 * - `atencao` — publicado, mas de um jeito que não sustenta envio em volume
 *   (`p=none` no DMARC, SPF sem `all`). NÃO bloqueia o veredito.
 * - `ausente` — não encontrado. Bloqueia: é a pergunta sem resposta.
 * - `conflitante` — encontrado e INVÁLIDO do jeito que está (dois SPF, chave DKIM
 *   revogada, DMARC sem `p=`). Bloqueia: pior que ausente, porque parece feito.
 */
export type EstadoDoRegistro = "ok" | "atencao" | "ausente" | "conflitante";

/** Uma linha da tabela de registros da tela. */
export interface RegistroDoDominio {
  readonly tipo: TipoDeRegistro;
  /** O nome que precisa existir no DNS (FQDN). */
  readonly nome: string;
  /** O que o DNS respondeu — `null` quando não há nada publicado. */
  readonly encontrado: string | null;
  /** O que o provedor pede para publicar — a orientação quando falta. */
  readonly esperado: string;
  readonly estado: EstadoDoRegistro;
  /** Frase da linha, em português, pronta para a tela. `null` quando `ok`. */
  readonly problema: string | null;
}

/** O que o DNS respondeu para cada nome que o domínio de envio usa. */
export interface RespostasDns {
  /** TXT do domínio raiz — onde alguns provedores publicam o SPF. */
  readonly raizTxt: readonly (readonly string[])[];
  /** TXT de `send.<domínio>` — o subdomínio de envio da Resend. */
  readonly envioTxt: readonly (readonly string[])[];
  /** MX de `send.<domínio>` — o caminho de volta das voltas. */
  readonly envioMx: readonly string[];
  /** TXT de `resend._domainkey.<domínio>`. */
  readonly dkimTxt: readonly (readonly string[])[];
  /** TXT de `_dmarc.<domínio>`. */
  readonly dmarcTxt: readonly (readonly string[])[];
}

/** O diagnóstico inteiro — uma linha por registro, mais o veredito. */
export interface DiagnosticoDoDominioDeEnvio {
  readonly dominio: string;
  readonly registros: readonly RegistroDoDominio[];
  /** O que impede o envio em volume. Vazio = pode enviar. */
  readonly bloqueios: readonly string[];
  /** O que não impede, mas o provedor do destinatário vai cobrar depois. */
  readonly avisos: readonly string[];
  readonly prontoParaEnviar: boolean;
  /** Quando a conferência foi feita (ISO). Vem de fora: esta peça não lê relógio. */
  readonly conferidoEm: string;
}

/** A política do registro DMARC, do jeito que ela foi publicada. */
export interface PoliticaDmarc {
  readonly politica: "none" | "quarantine" | "reject" | null;
  readonly pct: number | null;
  /** `true` quando há `rua=` — sem ele ninguém recebe os relatórios de falha. */
  readonly temRelatorio: boolean;
  /** `adkim=s` ou `aspf=s`: alinhamento ESTRITO, que quebra encaminhamento. */
  readonly alinhamentoEstrito: boolean;
}

/** O que se pede para publicar quando o registro está ausente. */
export const SPF_ESPERADO = "v=spf1 include:amazonses.com ~all";
export const DKIM_ESPERADO = "v=DKIM1; k=rsa; p=<chave pública do provedor>";
export const MX_ESPERADO = "feedback-smtp.<região>.amazonses.com (prioridade 10)";

/**
 * O DMARC de partida — MONITORAMENTO, não bloqueio.
 *
 * `p=none` de propósito: quem está começando precisa ver os relatórios antes de
 * mandar recusar. Publicar `p=reject` no primeiro dia, com um domínio que também
 * manda e-mail de sistema por outro caminho, derruba o e-mail legítimo.
 */
export const DMARC_ESPERADO = (dominio: string): string =>
  `v=DMARC1; p=none; rua=mailto:dmarc@${dominio}`;

/** Os nomes que o domínio de envio da Resend usa. Exportados para a coleta e o teste. */
export const nomeDoEnvio = (dominio: string): string => `send.${dominio}`;
export const nomeDoDkim = (dominio: string): string => `resend._domainkey.${dominio}`;
export const nomeDoDmarc = (dominio: string): string => `_dmarc.${dominio}`;

/** Um rótulo de domínio: letra/dígito nas pontas, hífen só no meio. */
const ROTULO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * O domínio de um ENDEREÇO ou de um domínio digitado, em minúsculas e sem o ponto
 * final do FQDN. `null` = não é domínio.
 *
 * Aceita as duas entradas porque a tela tem UM campo: quem colou
 * `contato@lojadaana.com` quer conferir `lojadaana.com`, e recusar o endereço
 * inteiro seria uma parede sem motivo. Também recusa o que NÃO é nome de
 * máquina — esquema, caminho, espaço, sublinhado, rótulo com hífen nas pontas —
 * porque consultar DNS com lixo devolve `ENOTFOUND` e a tela mostraria "tudo
 * ausente" para um erro de digitação.
 */
export function dominioDeEndereco(entrada: string | null | undefined): string | null {
  const cru = (entrada ?? "").trim().toLowerCase();
  if (!cru) return null;
  if (cru.includes("@")) {
    const partes = cru.split("@");
    if (partes.length !== 2) return null;
    const local = partes[0] ?? "";
    if (!local) return null;
  }
  const semPontoFinal = cru.includes("@") ? (cru.split("@")[1] ?? "") : cru;
  const dominio = semPontoFinal.endsWith(".") ? semPontoFinal.slice(0, -1) : semPontoFinal;
  if (!dominio || dominio.length > 253) return null;
  const rotulos = dominio.split(".");
  // Um rótulo só não é domínio público: `localhost` e `send` existem no DNS
  // interno da VPS, e aceitá-los faria a tela conferir a máquina errada.
  if (rotulos.length < 2) return null;
  if (!rotulos.every((rotulo) => ROTULO.test(rotulo))) return null;
  const tld = rotulos[rotulos.length - 1] ?? "";
  // TLD numérico é endereço IP, não nome.
  if (tld.length < 2 || /^\d+$/.test(tld)) return null;
  return dominio;
}

/**
 * As respostas TXT de uma consulta, uma string por REGISTRO.
 *
 * O resolvedor devolve `string[][]` porque um TXT grande é publicado em pedaços
 * (255 bytes cada) e quem lê tem de COLAR os pedaços do mesmo registro — emendar
 * pedaços de registros diferentes produziria uma chave DKIM que não existe. O
 * DKIM da Resend tem 400+ caracteres e chega partido, então esta junção não é
 * zelo: é o caso normal.
 */
export function textosDosRegistros(consultas: readonly (readonly string[])[] | undefined): string[] {
  if (!Array.isArray(consultas)) return [];
  const saida: string[] = [];
  for (const consulta of consultas) {
    const pedacos = Array.isArray(consulta) ? consulta : typeof consulta === "string" ? [consulta] : [];
    const texto = pedacos.filter((p) => typeof p === "string").join("").trim();
    if (texto) saida.push(texto);
  }
  return saida;
}

const ehSpf = (texto: string): boolean => /^v=spf1(\s|$)/i.test(texto);
const ehDmarc = (texto: string): boolean => /^v=dmarc1(\s|;|$)/i.test(texto);

/** Os mecanismos do SPF, em minúsculas, sem o `v=spf1`. */
function mecanismosDoSpf(registro: string): string[] {
  return registro
    .split(/\s+/)
    .slice(1)
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

/** O qualificador do `all` final: `-` (falha), `~` (softfail), `?` (neutro), `+` (passa). */
function qualificadorDoAll(mecanismos: readonly string[]): string | null {
  const all = mecanismos.find((m) => m.endsWith("all") && m.length <= 5);
  if (!all) return null;
  const qualificador = all.slice(0, all.length - 3);
  return qualificador === "" ? "+" : qualificador;
}

/**
 * Lê o registro DMARC. Aceita qualquer ordem/ caixa nas tags, porque quem publica
 * digita à mão no painel do registrador e `P=REJECT` é tão válido quanto
 * `p=reject`.
 *
 * `null` = o registro não tem `p=` — ilegível como política, e é o caso que o
 * `estado` marca como `conflitante`.
 */
export function lerPoliticaDmarc(registro: string): PoliticaDmarc {
  const tags = new Map<string, string>();
  for (const parte of registro.split(";")) {
    const corte = parte.indexOf("=");
    if (corte <= 0) continue;
    const chave = parte.slice(0, corte).trim().toLowerCase();
    const valor = parte.slice(corte + 1).trim().toLowerCase();
    if (chave && !tags.has(chave)) tags.set(chave, valor);
  }
  const politicaCrua = tags.get("p");
  const politica =
    politicaCrua === "none" || politicaCrua === "quarantine" || politicaCrua === "reject"
      ? politicaCrua
      : null;
  const pctCru = tags.get("pct");
  const pct = pctCru && /^\d{1,3}$/.test(pctCru) ? Number(pctCru) : null;
  return {
    politica,
    pct: pct !== null && pct >= 0 && pct <= 100 ? pct : null,
    temRelatorio: (tags.get("rua") ?? "").length > 0,
    alinhamentoEstrito: tags.get("adkim") === "s" || tags.get("aspf") === "s",
  };
}

function registroSpf(
  dominio: string,
  respostas: RespostasDns,
): RegistroDoDominio {
  const doEnvio = textosDosRegistros(respostas.envioTxt).filter(ehSpf);
  const daRaiz = textosDosRegistros(respostas.raizTxt).filter(ehSpf);
  // O subdomínio de envio MANDA: é nele que a Resend publica. A raiz é o
  // caminho de quem usa outro provedor — e por isso o nome mostrado muda junto.
  const noEnvio = doEnvio.length > 0;
  const registros = noEnvio ? doEnvio : daRaiz;
  const nome = noEnvio ? nomeDoEnvio(dominio) : dominio;

  if (registros.length === 0) {
    return {
      tipo: "spf",
      nome,
      encontrado: null,
      esperado: SPF_ESPERADO,
      estado: "ausente",
      problema: `Nenhum registro SPF em ${nomeDoEnvio(dominio)} nem em ${dominio}: sem ele o destinatário não tem como saber que o provedor está autorizado a entregar pelo seu domínio.`,
    };
  }
  if (registros.length > 1) {
    return {
      tipo: "spf",
      nome,
      encontrado: registros.join(" | "),
      esperado: SPF_ESPERADO,
      estado: "conflitante",
      problema: `Há ${registros.length} registros SPF em ${nome}. A norma (RFC 7208) manda tratar dois registros como erro: quem recebe não escolhe um, descarta os dois. Junte tudo em um só.`,
    };
  }
  const unico = registros[0] ?? "";
  const qualificador = qualificadorDoAll(mecanismosDoSpf(unico));
  if (qualificador === null) {
    return {
      tipo: "spf",
      nome,
      encontrado: unico,
      esperado: SPF_ESPERADO,
      estado: "atencao",
      problema: "O registro SPF não termina em `all`: sem ele, um domínio que não está na lista continua podendo entregar em seu nome.",
    };
  }
  if (qualificador === "?" || qualificador === "+") {
    return {
      tipo: "spf",
      nome,
      encontrado: unico,
      esperado: SPF_ESPERADO,
      estado: "atencao",
      problema: "O final do registro SPF é neutro (`?all` ou `+all`): ele não protege nada, porque aceita qualquer remetente.",
    };
  }
  return { tipo: "spf", nome, encontrado: unico, esperado: SPF_ESPERADO, estado: "ok", problema: null };
}

function registroDkim(dominio: string, respostas: RespostasDns): RegistroDoDominio {
  const nome = nomeDoDkim(dominio);
  const todos = textosDosRegistros(respostas.dkimTxt);
  if (todos.length === 0) {
    return {
      tipo: "dkim",
      nome,
      encontrado: null,
      esperado: DKIM_ESPERADO,
      estado: "ausente",
      problema: `Nenhum registro DKIM em ${nome}. É ele que prova que a mensagem não foi trocada no caminho — sem DKIM, a maioria dos provedores recusa envio em volume. Se o seu provedor usa outro seletor, confira o nome no painel dele.`,
    };
  }
  // O primeiro registro é o do seletor; os outros seriam rotação de chave, que a
  // conferência não sabe escolher. Um `p=` vazio REVOGA a chave.
  const registro = todos[0] ?? "";
  const chave = /(?:^|;)\s*p=([^;]*)/i.exec(registro);
  if (!chave) {
    return {
      tipo: "dkim",
      nome,
      encontrado: registro,
      esperado: DKIM_ESPERADO,
      estado: "conflitante",
      problema: "O registro DKIM não tem o campo `p=` com a chave pública: o destinatário não tem com o que conferir a assinatura.",
    };
  }
  if ((chave[1] ?? "").trim() === "") {
    return {
      tipo: "dkim",
      nome,
      encontrado: registro,
      esperado: DKIM_ESPERADO,
      estado: "conflitante",
      problema: "O registro DKIM está com `p=` vazio, que é como se REVOGA uma chave: toda mensagem assinada por ela é tratada como não assinada.",
    };
  }
  return { tipo: "dkim", nome, encontrado: registro, esperado: DKIM_ESPERADO, estado: "ok", problema: null };
}

function registroMx(dominio: string, respostas: RespostasDns): RegistroDoDominio {
  const nome = nomeDoEnvio(dominio);
  const mx = (respostas.envioMx ?? []).map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  if (mx.length === 0) {
    return {
      tipo: "mx",
      nome,
      encontrado: null,
      esperado: MX_ESPERADO,
      estado: "ausente",
      problema: `Nenhum MX em ${nome}: é por ali que as voltas (caixa cheia, endereço inexistente) chegam ao provedor. Sem elas, a lista de supressão não aprende e o próximo envio repete o erro.`,
    };
  }
  if (mx.every((valor) => valor === ".")) {
    return {
      tipo: "mx",
      nome,
      encontrado: mx.join(", "),
      esperado: MX_ESPERADO,
      estado: "conflitante",
      problema: "O MX publicado é o `null MX` (`.`), que declara o domínio como NÃO recebedor de e-mail: as voltas nunca chegam.",
    };
  }
  return { tipo: "mx", nome, encontrado: mx.join(", "), esperado: MX_ESPERADO, estado: "ok", problema: null };
}

function registroDmarc(dominio: string, respostas: RespostasDns): RegistroDoDominio {
  const nome = nomeDoDmarc(dominio);
  const esperado = DMARC_ESPERADO(dominio);
  const doDmarc = textosDosRegistros(respostas.dmarcTxt).filter(ehDmarc);
  if (doDmarc.length === 0) {
    return {
      tipo: "dmarc",
      nome,
      encontrado: null,
      esperado,
      estado: "ausente",
      problema: `Nenhum DMARC em ${nome}: quem envia em volume pelo Gmail e pelo Yahoo precisa de uma política publicada, e sem ela o e-mail pode ser recusado em bloco.`,
    };
  }
  if (doDmarc.length > 1) {
    return {
      tipo: "dmarc",
      nome,
      encontrado: doDmarc.join(" | "),
      esperado,
      estado: "conflitante",
      problema: `Há ${doDmarc.length} registros DMARC em ${nome}: a norma só permite um, e dois são ignorados por completo.`,
    };
  }
  const registro = doDmarc[0] ?? "";
  const politica = lerPoliticaDmarc(registro);
  if (!politica.politica) {
    return {
      tipo: "dmarc",
      nome,
      encontrado: registro,
      esperado,
      estado: "conflitante",
      problema: "O registro DMARC não tem `p=` válido (`none`, `quarantine` ou `reject`): sem política, o registro não diz o que fazer com quem falha.",
    };
  }
  if (politica.politica === "none") {
    return {
      tipo: "dmarc",
      nome,
      encontrado: registro,
      esperado,
      estado: "atencao",
      problema: "A política é só de MONITORAMENTO (`p=none`): cumpre a exigência de publicar DMARC, mas não pede que o provedor recuse o que não passa. Depois de alguns dias de relatório sem falha legítima, passe para `p=quarantine`.",
    };
  }
  if (politica.pct !== null && politica.pct < 100) {
    return {
      tipo: "dmarc",
      nome,
      encontrado: registro,
      esperado,
      estado: "atencao",
      problema: `A política vale para só ${politica.pct}% das mensagens (\`pct=${politica.pct}\`): o resto passa sem a checagem.`,
    };
  }
  return { tipo: "dmarc", nome, encontrado: registro, esperado, estado: "ok", problema: null };
}

/**
 * O diagnóstico do domínio: as quatro linhas, os bloqueios, os avisos e o
 * veredito. `null` quando a entrada não é domínio (a tela diz "domínio inválido"
 * antes de qualquer consulta).
 *
 * `conferidoEm` entra como argumento porque esta peça não lê relógio: quem chama
 * carimba a hora uma vez, e o teste compara o valor em vez de tolerar "agora".
 */
export function diagnosticarDominioDeEnvio(
  entrada: string,
  respostas: RespostasDns,
  conferidoEm: string,
): DiagnosticoDoDominioDeEnvio | null {
  const dominio = dominioDeEndereco(entrada);
  if (!dominio) return null;

  const registros = [
    registroSpf(dominio, respostas),
    registroDkim(dominio, respostas),
    registroMx(dominio, respostas),
    registroDmarc(dominio, respostas),
  ] as const;

  const bloqueios = registros
    .filter((r) => r.estado === "ausente" || r.estado === "conflitante")
    .map((r) => r.problema ?? `${r.tipo}: ${r.estado}`);
  const avisos = registros.filter((r) => r.estado === "atencao").map((r) => r.problema ?? r.tipo);

  const dmarc = registros[3];
  const politica = dmarc.encontrado ? lerPoliticaDmarc(dmarc.encontrado) : null;
  if (politica && !politica.temRelatorio) {
    // Aviso, não bloqueio: sem `rua=` o envio funciona, mas ninguém descobre as
    // falhas — e é justamente a falha silenciosa que queima reputação.
    avisos.push(
      `O DMARC não tem \`rua=\`: você não recebe os relatórios de falha, e só descobre um problema de autenticação quando o e-mail já parou de chegar.`,
    );
  }
  if (politica?.alinhamentoEstrito) {
    avisos.push(
      "O DMARC está com alinhamento ESTRITO (`adkim=s`/`aspf=s`): mensagens encaminhadas por terceiros passam a falhar na autenticação.",
    );
  }

  return {
    dominio,
    registros,
    bloqueios,
    avisos,
    prontoParaEnviar: bloqueios.length === 0,
    conferidoEm,
  };
}
