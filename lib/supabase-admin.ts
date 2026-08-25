type Resource = "niches" | "categories" | "services";

const cleanEnv = (input?: string) => input?.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

export function getSupabaseAdminConfig() {
  const url = cleanEnv(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const key = cleanEnv(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY,
  );
  const schema = cleanEnv(process.env.SUPABASE_SCHEMA) || "public";
  const tables: Record<Resource, string> = {
    niches: cleanEnv(process.env.SUPABASE_NICHES_TABLE) || "niches",
    categories: cleanEnv(process.env.SUPABASE_CATEGORIES_TABLE) || "categories",
    services: cleanEnv(process.env.SUPABASE_SERVICES_TABLE) || "services",
  };
  return { url, key, schema, tables };
}

export function supabaseHeaders(key: string, schema: string, write = false) {
  const headers: Record<string, string> = {
    apikey: key,
    Accept: "application/json",
    "Accept-Profile": schema,
  };
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = schema;
    headers.Prefer = "return=representation";
  }
  return headers;
}

export function cleanAdminPayload(resource: Resource, data: Record<string, unknown>) {
  const active = data.active !== false;
  if (resource === "niches") {
    return {
      name: String(data.name || "").trim(),
      slug: String(data.slug || "").trim(),
      active,
    };
  }
  if (resource === "categories") {
    return {
      niche_id: String(data.niche_id || "").trim(),
      name: String(data.name || "").trim(),
      sort_order: Math.max(0, Number(data.sort_order) || 0),
      active,
    };
  }
  const billing = ["monthly", "one_time", "setup"].includes(String(data.billing_type)) ? String(data.billing_type) : "one_time";
  const minQuantity = Math.max(1, Number(data.min_quantity) || 1);
  const maxQuantity = data.max_quantity === null || data.max_quantity === "" || data.max_quantity === undefined
    ? null
    : Math.max(minQuantity, Number(data.max_quantity) || minQuantity);
  return {
    niche_id: String(data.niche_id || "").trim(),
    category_id: String(data.category_id || "").trim(),
    name: String(data.name || "").trim(),
    description: String(data.description || "").trim(),
    unit: String(data.unit || "unidade").trim(),
    billing_type: billing,
    price: Math.max(0, Number(data.price) || 0),
    default_quantity: Math.max(minQuantity, Number(data.default_quantity) || minQuantity),
    min_quantity: minQuantity,
    max_quantity: maxQuantity,
    active,
  };
}

export type AdminResource = Resource;
