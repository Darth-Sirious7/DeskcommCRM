---
impacto: capacidade_nova
secao: adicionado
titulo: Conferência do domínio de envio de e-mail da organização, pelo DNS
---

Em Configurações → Marca há agora o card **Domínio de envio**: informe o domínio (ou cole o endereço de remetente, que o domínio vem junto) e o sistema lê o DNS público e mostra, linha por linha, o que está publicado e o que falta — SPF, DKIM, MX de retorno e DMARC.

Cada linha traz o nome exato do registro para copiar no painel do registrador, o que o DNS respondeu hoje e o que deveria responder. O resultado separa **bloqueios** de **avisos**: falta de SPF, DKIM sem chave, MX de retorno ausente, DMARC ausente e registro inválido bloqueiam o envio em volume; `p=none`, SPF sem `all` e `pct` abaixo de 100 aparecem como aviso, porque publicam algo sem proteger de fato.

A conferência é do DNS público, não do painel do provedor: é o que o Gmail e o Yahoo leem. Dois registros SPF, chave DKIM revogada (`p=` vazio), `null MX` e DMARC sem `p=` são apontados como inválidos, não como ausentes. Nada é gravado no banco e nenhuma chave é usada — a tela só consulta e mostra.

Contribuição de @webtecnica (#3441).
