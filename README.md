# Sagitário — Montador de Propostas

Aplicação de página única da Frame Rec para selecionar serviços, calcular valores e gerar propostas comerciais em PDF.

## Requisitos

- Node.js 22
- Projeto Supabase configurado somente para leitura

## Desenvolvimento

```bash
npm ci
npm run dev
```

## Produção na Hostinger

- Framework: Next.js
- Comando de build: `npm run build`
- Comando de inicialização: `npm start`
- Versão do Node.js: 22

Cadastre no painel da aplicação as variáveis de ambiente listadas em `.env.example`. A chave secreta do Supabase deve permanecer protegida no servidor e nunca ser adicionada ao GitHub.

Variáveis obrigatórias:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

As demais variáveis de mapeamento são opcionais e só precisam ser alteradas quando os nomes do schema ou das tabelas forem diferentes.
