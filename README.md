# Sagitário — Montador de Propostas

Aplicação da Frame Rec para selecionar serviços, calcular valores, gerar propostas comerciais em PDF e administrar o catálogo em `/admin`.

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
- `ADMIN_PASSWORD`

As demais variáveis de mapeamento são opcionais e só precisam ser alteradas quando os nomes do schema ou das tabelas forem diferentes.
