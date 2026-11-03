# SeuChico — melhoria visual rápida

Este pacote preserva a lógica existente e aplica uma camada visual mais apresentável para demonstrações e capturas de tela.

## O que foi melhorado

- Cabeçalho compartilhado com aparência de cartão e melhor separação visual.
- Fundos com detalhes suaves usando as cores configuradas pelo administrador.
- Sombras consistentes em banners, painéis, cartões, pedidos, relatórios e formulários.
- Fundo mais acolhedor nas telas de acesso, cadastro, recuperação e documentos.
- Compatibilidade de tipagem com os imports CSS e o Expo/React Native atual.
- NativeWind mantido configurado para a futura migração gradual dos componentes.

## Como aplicar

1. Pare o Metro com `Ctrl+C`.
2. Extraia este ZIP fora da pasta atual do projeto.
3. Copie o conteúdo extraído para `C:\Projetos\seuchico-app`.
4. Quando o Windows perguntar, escolha **Substituir os arquivos no destino**.
5. No terminal da raiz do projeto, execute:

```powershell
npm.cmd install
npx.cmd expo start --clear
```

## Segurança da alteração

Não foram modificadas consultas do Supabase, regras de autenticação, pagamentos, PIX, rotas, notificações nem ações dos botões. As alterações são de estilo e compatibilidade visual.

O arquivo `src/app/teste-nativewind.tsx` foi mantido temporariamente para conferência do framework e pode ser excluído depois das capturas.
