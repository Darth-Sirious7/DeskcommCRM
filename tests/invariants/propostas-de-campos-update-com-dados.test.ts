import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

/** Uma instalação que aplicou a 0772 pode já ter anonimizados com motivo legível. */
describe("propostas: atualização sobre dados da migration original", () => {
  it("corrige o motivo legado de contato já anonimizado sem exigir nova anonimização", () => {
    const original = readFileSync(join(process.cwd(), "supabase/migrations/20261026140000_0772_fila_de_proposta_de_campos_do_negocio.sql"), "utf8");
    const correcao = readFileSync(join(process.cwd(), "supabase/migrations/20261026190000_0797_propostas_de_campos_redigem_motivo_recusa.sql"), "utf8");
    const saida = sql(`
      begin;
      ${original}
      create temporary table prova_update_propostas (fase text, dados jsonb);
      create temporary table alvo_update_propostas (org uuid, contato uuid, proposta uuid);
      do $prova$
      declare
        org uuid := gen_random_uuid(); contato uuid := gen_random_uuid();
        funil uuid := gen_random_uuid(); etapa uuid := gen_random_uuid();
        negocio uuid := gen_random_uuid(); proposta uuid := gen_random_uuid();
      begin
        insert into public.organizations (id,slug,legal_name,display_name)
          values (org,'proposta-' || org,'Empresa sintética','Prova update');
        insert into public.contacts (id,organization_id,name,display_name)
          values (contato,org,'Pessoa Sintética Legada','Pessoa Sintética Legada');
        insert into public.crm_pipelines (id,organization_id,name,slug)
          values (funil,org,'Prova update','prova-update');
        insert into public.crm_stages (id,organization_id,pipeline_id,name,slug,position)
          values (etapa,org,funil,'Entrada','entrada',1000);
        insert into public.crm_leads (id,organization_id,pipeline_id,stage_id,contact_id,title)
          values (negocio,org,funil,etapa,contato,'Documento sintético');
        insert into public.lead_field_proposals
          (id,organization_id,lead_id,campo,valor_proposto,trecho,motivo_recusa,status,decided_at,expires_at)
          values (proposta,org,negocio,'localizador','"ABC123"','Trecho sintético',
            'Localizador da Pessoa Sintética Legada está errado','dismissed',now(),now()+interval '7 days');
        perform public.fn_lgpd_cascade_redact_contact(org,contato,null);
        insert into alvo_update_propostas values (org,contato,proposta);
        insert into prova_update_propostas values ('antes', jsonb_build_object(
          'anonimizado',(select is_anonymized from public.contacts where id=contato),
          'motivo_legivel',(select motivo_recusa is not null from public.lead_field_proposals where id=proposta)
        ));
      end $prova$;
      ${correcao}
      insert into prova_update_propostas select 'depois', jsonb_build_object(
        'propostas_preservadas',(select count(*) from public.lead_field_proposals p where p.id=a.proposta),
        'motivo_legivel',(select motivo_recusa is not null from public.lead_field_proposals p where p.id=a.proposta)
      ) from alvo_update_propostas a;
      select jsonb_object_agg(fase,dados) from prova_update_propostas;
      rollback;
    `);
    const linha = saida.split("\n").find((l) => l.startsWith("{"));
    expect(linha, "a prova de atualização não produziu o retrato antes/depois").toBeDefined();
    expect(JSON.parse(linha!)).toEqual({
      antes: { anonimizado: true, motivo_legivel: true },
      depois: { propostas_preservadas: 1, motivo_legivel: false },
    });
  });
});
