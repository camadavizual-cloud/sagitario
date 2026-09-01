type Resource = "niches" | "services";
type Row = Record<string, unknown>;

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
  if (!key.startsWith("sb_")) headers.Authorization = "Bearer " + key;
  if (write) {
    headers["Content-Type"] = "application/json";
    headers["Content-Profile"] = schema;
    headers.Prefer = "return=representation";
  }
  return headers;
}

const aliases: Record<Resource, Record<string, string[]>> = {
  niches: {
    id: ["id", "uuid", "niche_id", "nicho_id", "codigo"],
    name: ["name", "nome", "title", "titulo", "título"],
    slug: ["slug", "identificador", "chave"],
    description: ["description", "descricao", "descrição", "details"],
    active: ["active", "ativo", "is_active"],
  },
  services: {
    id: ["id", "uuid", "service_id", "servico_id", "serviço_id", "codigo"],
    niche_id: ["niche_id", "nicho_id", "segment_id", "niche_ids", "nicho_ids"],
    name: ["name", "nome", "title", "titulo", "título"],
    description: ["description", "commercial_description", "descricao", "descrição", "resumo", "short_description"],
    unit: ["unit", "unidade", "price_unit", "unidade_preco", "unidade_preço"],
    billing_type: ["billing_type", "charge_type", "tipo_cobranca", "tipo_cobrança", "cobranca", "cobrança", "recurrence"],
    price: ["price", "preco", "preço", "valor", "unit_price", "valor_unitario", "valor_unitário"],
    default_quantity: ["default_quantity", "quantidade_padrao", "quantidade_padrão", "qtd_padrao", "qtd_padrão"],
    min_quantity: ["min_quantity", "quantidade_minima", "quantidade_mínima", "qtd_minima", "qtd_mínima"],
    max_quantity: ["max_quantity", "quantidade_maxima", "quantidade_máxima", "qtd_maxima", "qtd_máxima"],
    active: ["active", "ativo", "is_active"],
  },
};

const raw = (resource: Resource, row: Row, canonical: string) => {
  for (const key of aliases[resource][canonical] || [canonical]) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
};
const asText = (input: unknown) => String(input ?? "").trim();
const asNumber = (input: unknown, fallback = 0) => {
  const parsed = Number(input);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const asActive = (input: unknown) => input === undefined || [true, 1, "1", "true", "sim", "yes", "ativo"].includes(input as never);
const slugify = (input: string) => input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function billing(input: unknown): "monthly" | "one_time" | "setup" {
  const value = asText(input).toLowerCase();
  if (["monthly", "mensal", "recurring", "recorrente"].includes(value)) return "monthly";
  if (["setup", "initial", "taxa_inicial", "implantacao", "implantação"].includes(value)) return "setup";
  return "one_time";
}

function sourceColumn(resource: Resource, canonical: string, sample: Row, availableColumns?: ReadonlySet<string>) {
  return (aliases[resource][canonical] || [canonical]).find((key) => (
    Object.prototype.hasOwnProperty.call(sample, key) || availableColumns?.has(key)
  ));
}

export function normalizeAdminRows(resource: Resource, rows: Row[], fallbackNicheId = "") {
  return rows.map((row) => {
    const id = asText(raw(resource, row, "id"));
    const name = asText(raw(resource, row, "name"));
    if (resource === "niches") {
      return {
        id,
        name,
        slug: asText(raw(resource, row, "slug")) || slugify(name),
        description: asText(raw(resource, row, "description")),
        active: asActive(raw(resource, row, "active")),
      };
    }
    const nicheValue = raw(resource, row, "niche_id");
    const nicheFromArray = Array.isArray(row.niche_ids) ? asText(row.niche_ids[0])
      : Array.isArray(row.nicho_ids) ? asText(row.nicho_ids[0])
        : Array.isArray(row.segments) ? asText(row.segments[0])
          : Array.isArray(row.nichos) ? asText(row.nichos[0]) : "";
    const niche_id = asText(nicheValue) || nicheFromArray || fallbackNicheId;
    const minQuantity = Math.max(1, asNumber(raw(resource, row, "min_quantity"), 1));
    const maximum = raw(resource, row, "max_quantity");
    return {
      id,
      niche_id,
      name,
      description: asText(raw(resource, row, "description")),
      unit: asText(raw(resource, row, "unit")) || "unidade",
      billing_type: billing(raw(resource, row, "billing_type")),
      price: Math.max(0, asNumber(raw(resource, row, "price"), 0)),
      default_quantity: Math.max(minQuantity, asNumber(raw(resource, row, "default_quantity"), minQuantity)),
      min_quantity: minQuantity,
      max_quantity: maximum === undefined || maximum === null || maximum === "" ? null : Math.max(minQuantity, asNumber(maximum, minQuantity)),
      active: asActive(raw(resource, row, "active")),
    };
  });
}

export function mapPayloadToSource(resource: Resource, payload: Row, sample: Row, availableColumns?: ReadonlySet<string>) {
  if (!Object.keys(sample).length && !availableColumns?.size) return payload;
  const mapped: Row = {};
  for (const [canonical, input] of Object.entries(payload)) {
    const column = sourceColumn(resource, canonical, sample, availableColumns);
    if (column) {
      const arrayRelation = canonical === "niche_id" && (column.endsWith("_ids") || Array.isArray(sample[column]));
      mapped[column] = arrayRelation ? (input ? [input] : []) : input;
    }
  }
  return mapped;
}

export function sourceIdColumn(resource: Resource, sample: Row, availableColumns?: ReadonlySet<string>) {
  return sourceColumn(resource, "id", sample, availableColumns) || "id";
}

export function cleanAdminPayload(resource: Resource, data: Row) {
  const active = data.active !== false;
  if (resource === "niches") {
    return {
      name: asText(data.name),
      slug: asText(data.slug),
      description: asText(data.description),
      active,
    };
  }
  const minQuantity = Math.max(1, asNumber(data.min_quantity, 1));
  const maxQuantity = data.max_quantity === null || data.max_quantity === "" || data.max_quantity === undefined
    ? null
    : Math.max(minQuantity, asNumber(data.max_quantity, minQuantity));
  return {
    niche_id: asText(data.niche_id),
    name: asText(data.name),
    description: asText(data.description),
    unit: asText(data.unit) || "unidade",
    billing_type: billing(data.billing_type),
    price: Math.max(0, asNumber(data.price, 0)),
    default_quantity: Math.max(minQuantity, asNumber(data.default_quantity, minQuantity)),
    min_quantity: minQuantity,
    max_quantity: maxQuantity,
    active,
  };
}

export type AdminResource = Resource;
