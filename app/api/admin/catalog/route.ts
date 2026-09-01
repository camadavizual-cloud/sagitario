import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import {
  AdminResource,
  cleanAdminPayload,
  getSupabaseAdminConfig,
  mapPayloadToSource,
  normalizeAdminRows,
  sourceIdColumn,
  supabaseHeaders,
} from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const resources = new Set<AdminResource>(["niches", "categories", "services"]);

function isResource(value: unknown): value is AdminResource {
  return resources.has(value as AdminResource);
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as { message?: string; details?: string; hint?: string; code?: string };
    return [payload.message, payload.details, payload.hint, payload.code].filter(Boolean).join(" — ") || "Não foi possível salvar a alteração.";
  } catch {
    return "Não foi possível salvar a alteração.";
  }
}

type AdminConfig = ReturnType<typeof getSupabaseAdminConfig> & { url: string; key: string };
type ConfigResult =
  | { config: AdminConfig; response: null }
  | { config: null; response: NextResponse };
type ColumnMap = Partial<Record<AdminResource, Set<string>>>;

type ClinicSeed = {
  name: string;
  description: string;
  unit: string;
  billing_type: "monthly" | "one_time" | "setup";
  price: number;
};

const clinicSeedServices: ClinicSeed[] = [
  { name: "Design de post simples", description: "Posts estáticos.", unit: "post", billing_type: "one_time", price: 90 },
  { name: "Vídeo", description: "Captação na clínica, com iluminação e áudio profissional.", unit: "vídeo", billing_type: "one_time", price: 400 },
  { name: "Criação de carrosséis", description: "Até 6 lâminas (páginas).", unit: "carrossel", billing_type: "one_time", price: 200 },
  { name: "Disponibilidade de drone", description: "Para vídeos e fotos aéreas.", unit: "diária", billing_type: "one_time", price: 600 },
  { name: "Programação de postagens", description: "Agendamento de publicações e criação de textos para legenda.", unit: "mês", billing_type: "monthly", price: 400 },
  { name: "Gestão de Tráfego Pago", description: "No Meta Ads (Facebook e Instagram).", unit: "mês", billing_type: "monthly", price: 800 },
  { name: "Planejamento estratégico", description: "Criação de roteiro, tom de voz e linha editorial de todas as publicações da marca nas redes sociais (Facebook e Instagram).", unit: "projeto", billing_type: "one_time", price: 1200 },
];

// Stored in the existing niches.description column so a failed bootstrap can
// resume safely, while a completed bootstrap never resurrects deletions.
const clinicBootstrapPending = "sagitario:clinic-catalog:v1:pending";
const clinicBootstrapComplete = "sagitario:clinic-catalog:v1:complete";

const normalizeSeedName = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim()
  .toLocaleLowerCase("pt-BR");

function configResponse(): ConfigResult {
  const config = getSupabaseAdminConfig();
  if (!config.url || !config.key) return { config: null, response: NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 }) };
  return { config: config as AdminConfig, response: null };
}

const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === "object" ? value as Record<string, unknown> : {}
);

let schemaCache: { fingerprint: string; columns: ColumnMap } | null = null;

function schemaFingerprint(config: AdminConfig) {
  return [config.url, config.schema, config.tables.niches, config.tables.categories, config.tables.services].join("|");
}

async function loadSchemaColumns(config: AdminConfig): Promise<ColumnMap> {
  const fingerprint = schemaFingerprint(config);
  if (schemaCache?.fingerprint === fingerprint) return schemaCache.columns;
  const columns: ColumnMap = {};
  try {
    const response = await fetch(config.url + "/rest/v1/", {
      headers: supabaseHeaders(config.key, config.schema),
      cache: "no-store",
    });
    if (!response.ok) return columns;
    const document = record(await response.json());
    const definitions = record(document.definitions);
    const components = record(document.components);
    const schemas = record(components.schemas);
    for (const resource of resources) {
      const table = config.tables[resource];
      const definition = record(definitions[table] || schemas[table]);
      const properties = record(definition.properties);
      if (Object.keys(properties).length) columns[resource] = new Set(Object.keys(properties));
    }
  } catch {
    // The schema endpoint is a preflight enhancement. Existing row samples and
    // the compatibility payloads below remain the safe fallback when it is
    // unavailable in a restricted PostgREST configuration.
  }
  schemaCache = { fingerprint, columns };
  return columns;
}

async function loadRows(resource: AdminResource, config: AdminConfig, limitOne = false) {
  const { url, key, schema, tables } = config;
  const suffix = limitOne ? "&limit=1" : "";
  const response = await fetch(url + "/rest/v1/" + encodeURIComponent(tables[resource]) + "?select=*" + suffix, {
    headers: supabaseHeaders(key, schema),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json() as Promise<Array<Record<string, unknown>>>;
}

async function insertCatalogRow(
  resource: AdminResource,
  data: Record<string, unknown>,
  sample: Record<string, unknown>,
  config: AdminConfig,
  availableColumns?: ReadonlySet<string>,
) {
  const canonical = cleanAdminPayload(resource, data);
  const payload = mapPayloadToSource(resource, canonical, sample, availableColumns);
  const payloads = [payload];
  // The existing project uses commercial_description/unit_price in some
  // deployments. An empty table has no sample row for the normal mapper, so
  // keep a compatibility attempt for that schema without changing the
  // canonical admin model.
  if (resource === "categories" && !Object.keys(sample).length && !availableColumns?.size) {
    const withoutNiche = Object.fromEntries(Object.entries(canonical).filter(([key]) => key !== "niche_id"));
    payloads.unshift(withoutNiche);
  }
  if (resource === "services" && !Object.keys(sample).length && !availableColumns?.size) {
    const { description, price, ...rest } = canonical;
    const withoutNiche = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "niche_id"));
    payloads.splice(1, 0, withoutNiche);
    payloads.push({ ...withoutNiche, commercial_description: description, unit_price: price });
    payloads.push({ ...withoutNiche, niche_ids: canonical.niche_id ? [canonical.niche_id] : [], commercial_description: description, unit_price: price });
    payloads.push({ ...rest, commercial_description: description, unit_price: price });
  }
  const { url, key, schema, tables } = config;
  let lastError = "Não foi possível criar o cadastro.";
  for (const candidate of payloads) {
    const response = await fetch(url + "/rest/v1/" + encodeURIComponent(tables[resource]), {
      method: "POST",
      headers: supabaseHeaders(key, schema, true),
      body: JSON.stringify(candidate),
      cache: "no-store",
    });
    if (!response.ok) {
      lastError = await readError(response);
      continue;
    }
    const returned = await response.json().catch(() => []);
    const row = Array.isArray(returned) ? returned[0] : returned;
    if (!row || typeof row !== "object") throw new Error("O Supabase não devolveu o cadastro criado.");
    return row as Record<string, unknown>;
  }
  throw new Error(lastError);
}

async function updateCatalogRow(
  resource: AdminResource,
  id: string,
  data: Record<string, unknown>,
  sample: Record<string, unknown>,
  config: AdminConfig,
  availableColumns?: ReadonlySet<string>,
) {
  const payload = mapPayloadToSource(resource, data, sample, availableColumns);
  if (!Object.keys(payload).length) return;
  const { url, key, schema, tables } = config;
  const idColumn = sourceIdColumn(resource, sample, availableColumns);
  const endpoint = url + "/rest/v1/" + encodeURIComponent(tables[resource]) + "?" + encodeURIComponent(idColumn) + "=eq." + encodeURIComponent(id);
  const response = await fetch(endpoint, {
    method: "PATCH",
    headers: supabaseHeaders(key, schema, true),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await readError(response));
}

async function ensureClinicCatalog(config: AdminConfig, columns: ColumnMap) {
  const initialNiches = await loadRows("niches", config);
  let createdNiche = false;
  let niche = normalizeAdminRows("niches", initialNiches).find((item) => (
    normalizeSeedName(item.name) === "clinicas" || normalizeSeedName(item.slug) === "clinicas"
  ));
  if (!niche) {
    const created = await insertCatalogRow("niches", { name: "Clínicas", slug: "clinicas", description: clinicBootstrapPending, active: true }, initialNiches[0] || {}, config, columns.niches);
    niche = normalizeAdminRows("niches", [created])[0];
    createdNiche = true;
  }
  const nicheId = String(niche?.id || "").trim();
  if (!nicheId) throw new Error("O nicho Clínicas foi criado sem identificador.");
  const nicheDescription = String(niche?.description || "").trim();
  const isBootstrapMarker = nicheDescription === clinicBootstrapPending || nicheDescription === clinicBootstrapComplete;
  const shouldBootstrap = createdNiche || isBootstrapMarker || !nicheDescription;
  if (shouldBootstrap && !createdNiche && nicheDescription !== clinicBootstrapPending) {
    await updateCatalogRow("niches", nicheId, { description: clinicBootstrapPending }, initialNiches[0] || {}, config, columns.niches);
  }

  const initialCategories = await loadRows("categories", config);
  let category = normalizeAdminRows("categories", initialCategories, nicheId).find((item) => (
    normalizeSeedName(item.name) === "clinicas" && String(item.niche_id) === nicheId
  ));
  // A completed marker makes the bootstrap idempotent; an unmarked/partial
  // niche is allowed to finish after a failed request.
  if (!category && !shouldBootstrap) return { nicheId, categoryId: "", addedServices: 0 };
  if (!category) {
    const created = await insertCatalogRow("categories", { niche_id: nicheId, name: "Clínicas", sort_order: 0, active: true }, initialCategories[0] || {}, config, columns.categories);
    category = normalizeAdminRows("categories", [created], nicheId)[0];
  }
  const categoryId = String(category?.id || "").trim();
  if (!categoryId) throw new Error("A categoria Clínicas foi criada sem identificador.");

  // Services are bootstrapped only with the newly created niche/category.
  // Subsequent admin reads never recreate a service that the owner removed.
  if (!shouldBootstrap) return { nicheId, categoryId, addedServices: 0 };

  const initialServices = await loadRows("services", config);
  const normalizedServices = normalizeAdminRows("services", initialServices, nicheId);
  let addedServices = 0;
  for (const seed of clinicSeedServices) {
    const exists = normalizedServices.some((item) => (
      normalizeSeedName(item.name) === normalizeSeedName(seed.name) && String(item.category_id) === categoryId
    ));
    if (exists) continue;
    const created = await insertCatalogRow("services", {
      niche_id: nicheId,
      category_id: categoryId,
      name: seed.name,
      description: seed.description,
      unit: seed.unit,
      billing_type: seed.billing_type,
      price: seed.price,
      default_quantity: 1,
      min_quantity: 1,
      max_quantity: null,
      active: true,
    }, initialServices[0] || {}, config, columns.services);
    normalizedServices.push(normalizeAdminRows("services", [created], nicheId)[0]);
    addedServices += 1;
  }
  await updateCatalogRow("niches", nicheId, { description: clinicBootstrapComplete }, initialNiches[0] || {}, config, columns.niches);
  return { nicheId, categoryId, addedServices };
}

type LegacyCleanup = {
  planItems: number;
  plans: number;
};

const legacyTableNames = {
  plans: process.env.SUPABASE_PLANS_TABLE?.trim() || "plans",
  planItems: process.env.SUPABASE_PLAN_ITEMS_TABLE?.trim() || "plan_items",
};

const legacyColumns = {
  id: ["id", "uuid", "plan_id", "plano_id", "codigo"],
  niche: ["niche_id", "nicho_id", "segment_id"],
  plan: ["plan_id", "plano_id"],
  service: ["service_id", "servico_id", "serviço_id"],
};

function matchingColumn(sample: Record<string, unknown>, candidates: string[]) {
  return candidates.find((column) => Object.prototype.hasOwnProperty.call(sample, column));
}

async function loadLegacyRows(
  table: string,
  config: AdminConfig,
  column?: string,
  value?: string,
) {
  const { url, key, schema } = config;
  const filter = column && value !== undefined
    ? "&" + encodeURIComponent(column) + "=eq." + encodeURIComponent(value)
    : "&limit=1";
  const response = await fetch(url + "/rest/v1/" + encodeURIComponent(table) + "?select=*" + filter, {
    headers: supabaseHeaders(key, schema),
    cache: "no-store",
  });
  if (response.status === 404) return [];
  if (!response.ok) {
    const detail = await readError(response);
    if (/42P01|does not exist|not found/i.test(detail)) return [];
    throw new Error(detail);
  }
  return response.json() as Promise<Array<Record<string, unknown>>>;
}

async function deleteLegacyRows(
  table: string,
  column: string,
  value: string,
  config: AdminConfig,
) {
  const { url, key, schema } = config;
  const endpoint = url + "/rest/v1/" + encodeURIComponent(table) + "?" + encodeURIComponent(column) + "=eq." + encodeURIComponent(value);
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: supabaseHeaders(key, schema, true),
  });
  if (!response.ok) throw new Error(await readError(response));
  const deleted = await response.json().catch(() => []);
  return Array.isArray(deleted) ? deleted.length : 0;
}

async function removeLegacyServicePlanLinks(serviceId: string, config: AdminConfig) {
  const sample = (await loadLegacyRows(legacyTableNames.planItems, config))[0] || {};
  const serviceColumn = matchingColumn(sample, legacyColumns.service);
  if (!serviceColumn) return 0;
  return deleteLegacyRows(legacyTableNames.planItems, serviceColumn, serviceId, config);
}

async function removeLegacyNichePlans(nicheId: string, config: AdminConfig): Promise<LegacyCleanup> {
  const planSample = (await loadLegacyRows(legacyTableNames.plans, config))[0] || {};
  const planIdColumn = matchingColumn(planSample, legacyColumns.id);
  const planNicheColumn = matchingColumn(planSample, legacyColumns.niche);
  if (!planIdColumn || !planNicheColumn) return { planItems: 0, plans: 0 };

  const plans = await loadLegacyRows(legacyTableNames.plans, config, planNicheColumn, nicheId);
  const planIds = plans
    .map((plan) => String(plan[planIdColumn] ?? "").trim())
    .filter(Boolean);

  let planItems = 0;
  if (planIds.length) {
    const itemSample = (await loadLegacyRows(legacyTableNames.planItems, config))[0] || {};
    const itemPlanColumn = matchingColumn(itemSample, legacyColumns.plan);
    if (itemPlanColumn) {
      for (const planId of planIds) {
        planItems += await deleteLegacyRows(legacyTableNames.planItems, itemPlanColumn, planId, config);
      }
    }
  }

  const deletedPlans = await deleteLegacyRows(legacyTableNames.plans, planNicheColumn, nicheId, config);
  return { planItems, plans: deletedPlans };
}

export async function GET() {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  try {
    const columns = await loadSchemaColumns(resolved.config);
    const seeded = await ensureClinicCatalog(resolved.config, columns);
    const nicheRows = await loadRows("niches", resolved.config);
    const fallbackNicheId = nicheRows.length === 1 ? String(normalizeAdminRows("niches", nicheRows)[0]?.id || "") : "";
    const [categoryRows, serviceRows] = await Promise.all([
      loadRows("categories", resolved.config),
      loadRows("services", resolved.config),
    ]);
    const categories = normalizeAdminRows("categories", categoryRows, fallbackNicheId);
    const categoryNiches = new Map(categories.filter((item) => item.id && item.niche_id).map((item) => [item.id, item.niche_id]));
    const services = normalizeAdminRows("services", serviceRows, fallbackNicheId).map((item) => ({
      ...item,
      niche_id: item.niche_id || categoryNiches.get(String(item.category_id || "")) || "",
    }));
    return NextResponse.json({
      niches: normalizeAdminRows("niches", nicheRows),
      categories,
      services,
      seeded,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Falha ao carregar a administração." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { resource?: unknown; data?: Record<string, unknown> };
  if (!isResource(body.resource) || !body.data) return NextResponse.json({ message: "Cadastro inválido." }, { status: 400 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  const canonical = cleanAdminPayload(body.resource, body.data);
  if (!canonical.name || (body.resource === "services" && (!canonical.niche_id || !canonical.category_id))) {
    return NextResponse.json({ message: "Preencha os campos obrigatórios." }, { status: 400 });
  }
  try {
    const columns = await loadSchemaColumns(resolved.config);
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const item = await insertCatalogRow(body.resource, body.data, sample, resolved.config, columns[body.resource]);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível adicionar." }, { status: 502 });
  }
}

export async function PATCH(request: Request) {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { resource?: unknown; id?: unknown; data?: Record<string, unknown> };
  if (!isResource(body.resource) || !body.id || !body.data) return NextResponse.json({ message: "Alteração inválida." }, { status: 400 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  try {
    const columns = await loadSchemaColumns(resolved.config);
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const payload = mapPayloadToSource(body.resource, cleanAdminPayload(body.resource, body.data), sample, columns[body.resource]);
    const idColumn = sourceIdColumn(body.resource, sample, columns[body.resource]);
    const { url, key, schema, tables } = resolved.config;
    const endpoint = url + "/rest/v1/" + encodeURIComponent(tables[body.resource]) + "?" + encodeURIComponent(idColumn) + "=eq." + encodeURIComponent(String(body.id));
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: supabaseHeaders(key, schema, true),
      body: JSON.stringify(payload),
    });
    if (!response.ok) return NextResponse.json({ message: await readError(response) }, { status: response.status });
    return NextResponse.json({ item: (await response.json())[0] });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível alterar." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { resource?: unknown; id?: unknown };
  if (!isResource(body.resource) || !body.id) return NextResponse.json({ message: "Exclusão inválida." }, { status: 400 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  try {
    const columns = await loadSchemaColumns(resolved.config);
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const idColumn = sourceIdColumn(body.resource, sample, columns[body.resource]);
    const { url, key, schema, tables } = resolved.config;
    const endpoint = url + "/rest/v1/" + encodeURIComponent(tables[body.resource]) + "?" + encodeURIComponent(idColumn) + "=eq." + encodeURIComponent(String(body.id));
    let response = await fetch(endpoint, {
      method: "DELETE",
      headers: supabaseHeaders(key, schema, true),
    });
    if (!response.ok) {
      const detail = await readError(response);
      const isForeignKey = /23503|foreign key|violates.*constraint/i.test(detail);
      const isServicePlanLink = body.resource === "services" && /plan_items|plan.*service|service.*plan/i.test(detail);
      const isNichePlanLink = body.resource === "niches" && /plans|plan.*niche|niche.*plan/i.test(detail);

      if (isServicePlanLink) {
        const removedPlanItems = await removeLegacyServicePlanLinks(String(body.id), resolved.config);
        response = await fetch(endpoint, {
          method: "DELETE",
          headers: supabaseHeaders(key, schema, true),
        });
        if (response.ok) return NextResponse.json({ deleted: true, removedLegacyPlanItems: removedPlanItems });
        const retryDetail = await readError(response);
        return NextResponse.json({ message: "O vínculo antigo de plano foi removido, mas outro registro ainda protege este serviço: " + retryDetail }, { status: 409 });
      }

      if (isNichePlanLink) {
        const cleanup = await removeLegacyNichePlans(String(body.id), resolved.config);
        response = await fetch(endpoint, {
          method: "DELETE",
          headers: supabaseHeaders(key, schema, true),
        });
        if (response.ok) return NextResponse.json({ deleted: true, removedLegacy: cleanup });
        const retryDetail = await readError(response);
        return NextResponse.json({ message: "Os planos antigos ligados ao nicho foram removidos, mas outro registro ainda protege este nicho: " + retryDetail }, { status: 409 });
      }

      if (isForeignKey) {
        return NextResponse.json({ message: "Este cadastro ainda está ligado a outro registro protegido no Supabase. " + detail }, { status: 409 });
      }
      return NextResponse.json({ message: detail }, { status: response.status });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível apagar." }, { status: 502 });
  }
}
