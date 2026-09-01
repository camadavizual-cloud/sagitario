import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const value = (row: Row, ...keys: string[]) => keys.map((key) => row[key]).find((item) => item !== undefined && item !== null);
const text = (row: Row, ...keys: string[]) => String(value(row, ...keys) ?? "").trim();
const number = (row: Row, ...keys: string[]) => {
  const parsed = Number(value(row, ...keys) ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const bool = (row: Row, ...keys: string[]) => [true, 1, "1", "true", "sim", "yes", "ativo"].includes(value(row, ...keys) as never);

function billingType(row: Row): "monthly" | "one_time" | "setup" {
  const raw = text(row, "billing_type", "charge_type", "tipo_cobranca", "cobranca", "recurrence").toLowerCase();
  if (["monthly", "mensal", "recurring", "recorrente", "subscription", "assinatura"].includes(raw)) return "monthly";
  if (["setup", "initial", "taxa_inicial", "implantacao", "implantação", "activation", "ativacao", "ativação"].includes(raw)) return "setup";
  return "one_time";
}

function ids(row: Row): string[] {
  const raw = value(row, "niche_ids", "nicho_ids", "segments", "nichos");
  if (Array.isArray(raw)) return raw.map(String);
  const single = text(row, "niche_id", "nicho_id", "segment_id");
  return single ? [single] : [];
}

export async function GET() {
  const cleanEnv = (input?: string) => input?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = cleanEnv(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  );
  if (!url || !key) {
    return NextResponse.json({ message: "Cadastre SUPABASE_URL e SUPABASE_SECRET_KEY nas variáveis protegidas deste novo Site." }, { status: 503 });
  }

  const schema = process.env.SUPABASE_SCHEMA || "public";
  const tables = {
    niches: process.env.SUPABASE_NICHES_TABLE || "niches",
    services: process.env.SUPABASE_SERVICES_TABLE || "services",
    company: process.env.SUPABASE_COMPANY_TABLE || "company_settings",
  };

  const read = async (table: string): Promise<Row[]> => {
    const headers: Record<string, string> = {
      apikey: key,
      "Accept-Profile": schema,
    };

    // New Supabase sb_publishable_/sb_secret_ keys are opaque API keys, not
    // JWTs. Sending one as a Bearer token makes PostgREST reject the request.
    // Legacy anon/service_role keys are JWTs and still support Authorization.
    if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;

    const response = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=*`, {
      headers,
      cache: "no-store",
    });
    if (!response.ok) {
      let detail = "";
      try { const body = await response.json() as { message?: string }; detail = body.message || ""; } catch { detail = ""; }
      throw new Error(`Não foi possível ler a fonte “${table}”${detail ? `: ${detail}` : "."}`);
    }
    return response.json() as Promise<Row[]>;
  };

  const ensureDirectNicheRelation = async (rows: Row[]) => {
    const relationColumns = ["niche_id", "nicho_id", "segment_id", "niche_ids", "nicho_ids"];
    if (rows.length && rows.some((row) => relationColumns.some((column) => Object.prototype.hasOwnProperty.call(row, column)))) return;
    for (const column of relationColumns) {
      const response = await fetch(`${url}/rest/v1/${encodeURIComponent(tables.services)}?select=${encodeURIComponent(column)}&limit=0`, {
        headers: { apikey: key, "Accept-Profile": schema, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) },
        cache: "no-store",
      });
      if (response.ok) return;
    }
    throw new Error("A tabela services precisa de uma coluna niche_id (ou niche_ids) ligada a niches. Execute a migração SQL da versão de dois níveis.");
  };

  try {
    const [nicheRows, serviceRows, companyRows] = await Promise.all([
      read(tables.niches), read(tables.services), read(tables.company),
    ]);
    await ensureDirectNicheRelation(serviceRows);

    const active = (row: Row) => value(row, "active", "ativo", "is_active") === undefined || bool(row, "active", "ativo", "is_active");
    const niches = nicheRows.filter(active).map((row) => ({ id: text(row, "id", "uuid", "slug"), name: text(row, "name", "nome", "title", "titulo") })).filter((item) => item.id && item.name);
    const services = serviceRows.filter(active).map((row) => {
      const nicheIds = ids(row);
      return {
      id: text(row, "id", "uuid"), name: text(row, "name", "nome", "title", "titulo"), description: text(row, "description", "commercial_description", "descricao", "resumo"),
      nicheIds, unit: text(row, "unit", "unidade", "price_unit") || "unidade",
      billingType: billingType(row), price: number(row, "price", "preco", "valor", "unit_price"), defaultQuantity: Math.max(1, number(row, "default_quantity", "quantidade_padrao") || 1),
      minQuantity: Math.max(1, number(row, "min_quantity", "quantidade_minima") || 1), maxQuantity: number(row, "max_quantity", "quantidade_maxima") || null,
      };
    }).filter((item) => item.id && item.name && item.nicheIds.length);
    const companyRow = companyRows.find(active) || null;
    const company = companyRow ? { name: text(companyRow, "name", "nome", "company_name", "razao_social") || "Frame Rec", logoUrl: text(companyRow, "logo_url", "logo", "brand_logo_url") || null, document: text(companyRow, "document", "cnpj"), email: text(companyRow, "email", "contact_email"), phone: text(companyRow, "phone", "telefone", "whatsapp"), address: text(companyRow, "address", "endereco") } : null;

    return NextResponse.json({ niches, services, company }, { headers: { "Cache-Control": "no-store", "X-Sagitario-Build": "niches-services-v1", "X-Sagitario-Niche-Columns": Object.keys(nicheRows[0] || {}).sort().join(","), "X-Sagitario-Service-Columns": Object.keys(serviceRows[0] || {}).sort().join(",") } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao ler o catálogo do Supabase.";
    const invalidKey = /invalid api key/i.test(message);
    return NextResponse.json(
      {
        message: invalidKey
          ? "A chave configurada foi rejeitada pelo Supabase. Confirme se a URL e a chave pertencem ao mesmo projeto."
          : `${message} Confira os nomes das tabelas ou cadastre as variáveis opcionais de mapeamento.`,
      },
      {
        status: 502,
        headers: {
          "Cache-Control": "no-store",
          "X-Sagitario-Build": "supabase-key-normalization-v2",
        },
      },
    );
  }
}
