---
impacto: nada_mudou
secao: corrigido
titulo: Instalação em servidor único com o domínio atrás de proxy não para mais na conferência da chave
---

Na instalação em servidor único (o Supabase na mesma VPS do CRM), a conferência
da chave do Supabase falava com o domínio público — que só passa a responder
depois que o proxy da instalação sobe. Com o domínio atrás de proxy (Cloudflare
no modo laranja, o padrão do kit), essa conferência recebia 521 e a instalação
parava pedindo para conferir uma chave que estava certa. A conferência passa a
falar com o Supabase da própria VPS, como a validação do endereço já fazia nesse
modo; fora do servidor único, nada muda.

Você não precisa fazer nada.

Contribuição de @webtecnica (#2933).
