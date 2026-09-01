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

const resources = new Set<AdminResource>(["niches", "services"]);

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

function missingColumn(detail: string) {
  return detail.match(/Could not find the ['"]([^'"]+)['"] column/i)?.[1] || null;
}

const nicheRelationColumns = new Set(["niche_id", "nicho_id", "segment_id", "niche_ids", "nicho_ids"]);
const directNicheSchemaMessage = "Para usar apenas Nicho → Serviço, a tabela services precisa ter uma coluna niche_id (ou niche_ids) ligada à tabela niches. Execute a migração SQL fornecida nesta versão e tente novamente.";
const billingColumns = new Set(["billing_type", "charge_type", "tipo_cobranca", "tipo_cobrança", "cobranca", "cobrança", "recurrence"]);
const billingValueAliases: Record<ClinicSeed["billing_type"], string[]> = {
  one_time: ["one_time", "pontual", "PONTUAL", "one-time", "one time", "avulso", "AVULSO", "avulsa", "single", "fixed", "once", "oneoff", "one_off", "per_unit"],
  monthly: ["monthly", "mensal", "MENSAL", "recurring", "recorrente", "subscription", "assinatura", "recurring_monthly", "monthly_subscription"],
  setup: ["setup", "SETUP", "initial", "taxa_inicial", "taxa inicial", "implantacao", "implantação", "activation", "ativacao", "ativação", "initial_fee", "setup_fee"],
};

type AdminConfig = ReturnType<typeof getSupabaseAdminConfig> & { url: string; key: string };
type ConfigResult =
  | { config: AdminConfig; response: null }
  | { config: null; response: NextResponse };
type ColumnMap = Partial<Record<AdminResource, Set<string>>>;
type EnumMap = Partial<Record<AdminResource, Record<string, string[]>>>;

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

let schemaCache: { fingerprint: string; columns: ColumnMap; enums: EnumMap } | null = null;

function schemaFingerprint(config: AdminConfig) {
  return [config.url, config.schema, config.tables.niches, config.tables.services].join("|");
}

async function loadSchemaColumns(config: AdminConfig): Promise<ColumnMap> {
  const fingerprint = schemaFingerprint(config);
  if (schemaCache?.fingerprint === fingerprint) return schemaCache.columns;
  const columns: ColumnMap = {};
  const enums: EnumMap = {};
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
      if (Object.keys(properties).length) {
        columns[resource] = new Set(Object.keys(properties));
        const resourceEnums: Record<string, string[]> = {};
        for (const [column, value] of Object.entries(properties)) {
          const property = record(value);
          if (Array.isArray(property.enum)) {
            const values = property.enum.map((item) => String(item)).filter(Boolean);
            if (values.length) resourceEnums[column] = values;
          }
        }
        if (Object.keys(resourceEnums).length) enums[resource] = resourceEnums;
      }
    }
  } catch {
    // The schema endpoint is a preflight enhancement. Existing row samples and
    // the compatibility payloads below remain the safe fallback when it is
    // unavailable in a restricted PostgREST configuration.
  }
  schemaCache = { fingerprint, columns, enums };
  return columns;
}

function uniqueValues(values: Iterable<unknown>) {
  return [...new Set([...values].map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function billingEnumCandidates(resource: AdminResource, current: unknown, sample: Record<string, unknown>) {
  const canonical = String(current ?? "one_time").trim().toLowerCase() as ClinicSeed["billing_type"];
  const fallback = billingValueAliases[canonical] || billingValueAliases.one_time;
  const schemaValues = billingColumns.values();
  const knownValues: string[] = [];
  for (const column of schemaValues) {
    const values = schemaCache?.enums[resource]?.[column];
    if (values) knownValues.push(...values);
    if (sample[column] !== undefined && sample[column] !== null) knownValues.push(String(sample[column]));
  }
  const billingToken = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pt-BR").replace(/[\s-]+/g, "_");
  const preferredKnown = knownValues.filter((value) => fallback.some((alias) => billingToken(alias) === billingToken(value)));
  const remainingKnown = knownValues.filter((value) => !preferredKnown.includes(value));
  // Keep the semantic match first: a monthly service must never fall back to
  // the first enum label returned by PostgREST if that label means pontual.
  return uniqueValues([current, ...preferredKnown, ...fallback, ...remainingKnown]);
}

function billingColumn(payload: Record<string, unknown>) {
  return Object.keys(payload).find((column) => billingColumns.has(column));
}

function isBillingEnumError(detail: string) {
  return /22P02|invalid input value for enum/i.test(detail) && /billing|charge|cobran|recurr|tipo/i.test(detail);
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
  if (resource === "services" && !Object.keys(sample).length && !availableColumns?.size) {
    const { description, price, niche_id, ...rest } = canonical;
    payloads.push({ ...rest, niche_ids: niche_id ? [niche_id] : [], description, price });
    payloads.push({ ...rest, niche_ids: niche_id ? [niche_id] : [], commercial_description: description, unit_price: price });
    payloads.push({ ...rest, niche_id, commercial_description: description, unit_price: price });
  }
  if (resource === "services" && availableColumns?.size && ![...availableColumns].some((column) => nicheRelationColumns.has(column))) {
    throw new Error(directNicheSchemaMessage);
  }
  const { url, key, schema, tables } = config;
  let lastError = "Não foi possível criar o cadastro.";
  let missingNicheRelation = false;
  let billingEnumFailure = false;
  for (const initialCandidate of payloads) {
    const candidate = { ...initialCandidate };
    const attemptedBillingValues = new Set<string>();
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const currentBillingColumn = billingColumn(candidate);
      if (currentBillingColumn) attemptedBillingValues.add(String(candidate[currentBillingColumn] ?? ""));
      const response = await fetch(url + "/rest/v1/" + encodeURIComponent(tables[resource]), {
        method: "POST",
        headers: supabaseHeaders(key, schema, true),
        body: JSON.stringify(candidate),
        cache: "no-store",
      });
      if (!response.ok) {
        lastError = await readError(response);
        if (currentBillingColumn && isBillingEnumError(lastError)) {
          billingEnumFailure = true;
          const nextBillingValue = billingEnumCandidates(resource, candidate[currentBillingColumn], sample)
            .find((value) => !attemptedBillingValues.has(value));
          if (nextBillingValue) {
            candidate[currentBillingColumn] = nextBillingValue;
            continue;
          }
        }
        const column = /PGRST204/i.test(lastError) ? missingColumn(lastError) : null;
        if (column && Object.prototype.hasOwnProperty.call(candidate, column)) {
          if (resource === "services" && nicheRelationColumns.has(column)) {
            missingNicheRelation = true;
            break;
          }
          delete candidate[column];
          continue;
        }
        break;
      }
      const returned = await response.json().catch(() => []);
      const row = Array.isArray(returned) ? returned[0] : returned;
      if (!row || typeof row !== "object") throw new Error("O Supabase não devolveu o cadastro criado.");
      return row as Record<string, unknown>;
    }
  }
  if (resource === "services" && missingNicheRelation) throw new Error(directNicheSchemaMessage);
  if (billingEnumFailure) {
    throw new Error("O tipo de cobrança configurado no Supabase usa valores diferentes dos aceitos pelo painel. Verifique o enum da coluna billing_type e inclua Pontual, Mensal ou Taxa inicial.");
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
  if (resource === "services" && availableColumns?.size && ![...availableColumns].some((column) => nicheRelationColumns.has(column))) {
    throw new Error(directNicheSchemaMessage);
  }
  let payload = mapPayloadToSource(resource, data, sample, availableColumns);
  if (!Object.keys(payload).length) return null;
  const { url, key, schema, tables } = config;
  const idColumn = sourceIdColumn(resource, sample, availableColumns);
  const endpoint = url + "/rest/v1/" + encodeURIComponent(tables[resource]) + "?" + encodeURIComponent(idColumn) + "=eq." + encodeURIComponent(id);
  const attemptedBillingValues = new Set<string>();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const currentBillingColumn = billingColumn(payload);
    if (currentBillingColumn) attemptedBillingValues.add(String(payload[currentBillingColumn] ?? ""));
    const response = await fetch(endpoint, {
      method: "PATCH",
      headers: supabaseHeaders(key, schema, true),
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (response.ok) {
      const returned = await response.json().catch(() => []);
      return (Array.isArray(returned) ? returned[0] : returned) as Record<string, unknown> | null;
    }
    const detail = await readError(response);
    if (currentBillingColumn && isBillingEnumError(detail)) {
      const nextBillingValue = billingEnumCandidates(resource, payload[currentBillingColumn], sample)
        .find((value) => !attemptedBillingValues.has(value));
      if (nextBillingValue) {
        payload = { ...payload, [currentBillingColumn]: nextBillingValue };
        continue;
      }
      throw new Error("O tipo de cobrança configurado no Supabase usa valores diferentes dos aceitos pelo painel. Verifique o enum da coluna billing_type e inclua Pontual, Mensal ou Taxa inicial.");
    }
    const column = /PGRST204/i.test(detail) ? missingColumn(detail) : null;
    if (column && Object.prototype.hasOwnProperty.call(payload, column)) {
      if (resource === "services" && nicheRelationColumns.has(column)) throw new Error(directNicheSchemaMessage);
      const next = { ...payload };
      delete next[column];
      payload = next;
      if (!Object.keys(payload).length) return null;
      continue;
    }
    throw new Error(detail);
  }
  throw new Error("Não foi possível alterar o cadastro após validar as colunas do Supabase.");
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
  const isPendingBootstrap = nicheDescription === clinicBootstrapPending;
  const isCompleteBootstrap = nicheDescription === clinicBootstrapComplete;
  // A completed bootstrap is a durable snapshot: deleting a service in the
  // admin must not make it reappear on the next page load.
  const shouldBootstrap = createdNiche || isPendingBootstrap || (!nicheDescription && !isCompleteBootstrap);
  if (shouldBootstrap && !createdNiche && nicheDescription !== clinicBootstrapPending) {
    await updateCatalogRow("niches", nicheId, { description: clinicBootstrapPending }, initialNiches[0] || {}, config, columns.niches);
  }

  const initialServices = await loadRows("services", config);
  if (columns.services?.size && ![...columns.services].some((column) => nicheRelationColumns.has(column))) {
    throw new Error(directNicheSchemaMessage);
  }
  // Services are bootstrapped directly under the niche. Subsequent admin
  // reads never recreate a service that the owner removed.
  if (!shouldBootstrap) return { nicheId, addedServices: 0 };
  const normalizedServices = normalizeAdminRows("services", initialServices, nicheId);
  let addedServices = 0;
  for (const seed of clinicSeedServices) {
    const exists = normalizedServices.some((item) => (
      normalizeSeedName(item.name) === normalizeSeedName(seed.name) && (!item.niche_id || String(item.niche_id) === nicheId)
    ));
    if (exists) continue;
    const created = await insertCatalogRow("services", {
      niche_id: nicheId,
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
  return { nicheId, addedServices };
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
    const serviceRows = await loadRows("services", resolved.config);
    const services = normalizeAdminRows("services", serviceRows, fallbackNicheId);
    return NextResponse.json({
      niches: normalizeAdminRows("niches", nicheRows),
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
  if (!canonical.name || (body.resource === "services" && !canonical.niche_id)) {
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
    const item = await updateCatalogRow(body.resource, String(body.id), cleanAdminPayload(body.resource, body.data), sample, resolved.config, columns[body.resource]);
    return NextResponse.json({ item });
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
