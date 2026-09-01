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
  if (["monthly", "mensal", "recurring", "recorrente"].includes(raw)) return "monthly";
  if (["setup", "initial", "taxa_inicial", "implantacao", "implantação"].includes(raw)) return "setup";
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
    categories: process.env.SUPABASE_CATEGORIES_TABLE || "categories",
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

  try {
    const [nicheRows, categoryRows, serviceRows, companyRows] = await Promise.all([
      read(tables.niches), read(tables.categories), read(tables.services), read(tables.company),
    ]);

    const active = (row: Row) => value(row, "active", "ativo", "is_active") === undefined || bool(row, "active", "ativo", "is_active");
    const niches = nicheRows.filter(active).map((row) => ({ id: text(row, "id", "uuid", "slug"), name: text(row, "name", "nome", "title", "titulo") })).filter((item) => item.id && item.name);
    const categories = categoryRows.filter(active).map((row) => ({ id: text(row, "id", "uuid", "slug"), name: text(row, "name", "nome", "title", "titulo"), nicheId: text(row, "niche_id", "nicho_id", "segment_id") || null, order: number(row, "sort_order", "order", "ordem", "position") }));
    const categoryNiches = new Map(categories.filter((category) => category.id && category.nicheId).map((category) => [category.id, category.nicheId as string]));
    const services = serviceRows.filter(active).map((row) => {
      const categoryId = text(row, "category_id", "categoria_id") || null;
      const nicheIds = ids(row);
      if (!nicheIds.length && categoryId && categoryNiches.has(categoryId)) nicheIds.push(categoryNiches.get(categoryId) as string);
      return {
      id: text(row, "id", "uuid"), name: text(row, "name", "nome", "title", "titulo"), description: text(row, "description", "commercial_description", "descricao", "resumo"),
      categoryId, nicheIds, unit: text(row, "unit", "unidade", "price_unit") || "unidade",
      billingType: billingType(row), price: number(row, "price", "preco", "valor", "unit_price"), defaultQuantity: Math.max(1, number(row, "default_quantity", "quantidade_padrao") || 1),
      minQuantity: Math.max(1, number(row, "min_quantity", "quantidade_minima") || 1), maxQuantity: number(row, "max_quantity", "quantidade_maxima") || null,
      };
    }).filter((item) => item.id && item.name);
    const companyRow = companyRows.find(active) || null;
    const company = companyRow ? { name: text(companyRow, "name", "nome", "company_name", "razao_social") || "Frame Rec", logoUrl: text(companyRow, "logo_url", "logo", "brand_logo_url") || null, document: text(companyRow, "document", "cnpj"), email: text(companyRow, "email", "contact_email"), phone: text(companyRow, "phone", "telefone", "whatsapp"), address: text(companyRow, "address", "endereco") } : null;

    return NextResponse.json({ niches, categories, services, company }, { headers: { "Cache-Control": "no-store", "X-Sagitario-Niche-Columns": Object.keys(nicheRows[0] || {}).sort().join(","), "X-Sagitario-Category-Columns": Object.keys(categoryRows[0] || {}).sort().join(","), "X-Sagitario-Service-Columns": Object.keys(serviceRows[0] || {}).sort().join(",") } });
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
