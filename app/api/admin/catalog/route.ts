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

function configResponse(): ConfigResult {
  const config = getSupabaseAdminConfig();
  if (!config.url || !config.key) return { config: null, response: NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 }) };
  return { config: config as AdminConfig, response: null };
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

async function removeLegacyPlanLinks(serviceId: string, config: AdminConfig) {
  const table = process.env.SUPABASE_PLAN_ITEMS_TABLE?.trim() || "plan_items";
  const { url, key, schema } = config;
  const sampleResponse = await fetch(url + "/rest/v1/" + encodeURIComponent(table) + "?select=*&limit=1", {
    headers: supabaseHeaders(key, schema),
    cache: "no-store",
  });
  if (!sampleResponse.ok) return false;
  const sample = ((await sampleResponse.json()) as Array<Record<string, unknown>>)[0] || {};
  const serviceColumn = ["service_id", "servico_id", "serviço_id"].find((column) => Object.prototype.hasOwnProperty.call(sample, column));
  if (!serviceColumn) return false;
  const endpoint = url + "/rest/v1/" + encodeURIComponent(table) + "?" + encodeURIComponent(serviceColumn) + "=eq." + encodeURIComponent(serviceId);
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: supabaseHeaders(key, schema, true),
  });
  return response.ok;
}

export async function GET() {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  try {
    const nicheRows = await loadRows("niches", resolved.config);
    const fallbackNicheId = nicheRows.length === 1 ? String(normalizeAdminRows("niches", nicheRows)[0]?.id || "") : "";
    const [categoryRows, serviceRows] = await Promise.all([
      loadRows("categories", resolved.config),
      loadRows("services", resolved.config),
    ]);
    return NextResponse.json({
      niches: normalizeAdminRows("niches", nicheRows),
      categories: normalizeAdminRows("categories", categoryRows, fallbackNicheId),
      services: normalizeAdminRows("services", serviceRows, fallbackNicheId),
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
  if (!canonical.name || (body.resource !== "niches" && !canonical.niche_id) || (body.resource === "services" && !canonical.category_id)) {
    return NextResponse.json({ message: "Preencha os campos obrigatórios." }, { status: 400 });
  }
  try {
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const payload = mapPayloadToSource(body.resource, canonical, sample);
    const { url, key, schema, tables } = resolved.config;
    const response = await fetch(url + "/rest/v1/" + encodeURIComponent(tables[body.resource]), {
      method: "POST",
      headers: supabaseHeaders(key, schema, true),
      body: JSON.stringify(payload),
    });
    if (!response.ok) return NextResponse.json({ message: await readError(response) }, { status: response.status });
    return NextResponse.json({ item: (await response.json())[0] }, { status: 201 });
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
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const payload = mapPayloadToSource(body.resource, cleanAdminPayload(body.resource, body.data), sample);
    const idColumn = sourceIdColumn(body.resource, sample);
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
    const sample = (await loadRows(body.resource, resolved.config, true))[0] || {};
    const idColumn = sourceIdColumn(body.resource, sample);
    const { url, key, schema, tables } = resolved.config;
    const endpoint = url + "/rest/v1/" + encodeURIComponent(tables[body.resource]) + "?" + encodeURIComponent(idColumn) + "=eq." + encodeURIComponent(String(body.id));
    let response = await fetch(endpoint, {
      method: "DELETE",
      headers: supabaseHeaders(key, schema, true),
    });
    if (!response.ok) {
      const detail = await readError(response);
      const isPlanLink = body.resource === "services" && /plan_items|plan.*service|service.*plan/i.test(detail);
      if (isPlanLink && await removeLegacyPlanLinks(String(body.id), resolved.config)) {
        response = await fetch(endpoint, {
          method: "DELETE",
          headers: supabaseHeaders(key, schema, true),
        });
        if (response.ok) return NextResponse.json({ deleted: true, removedLegacyPlanLinks: true });
        const retryDetail = await readError(response);
        return NextResponse.json({ message: "O vínculo antigo de plano foi removido, mas outro registro ainda protege este serviço: " + retryDetail }, { status: 409 });
      }
      if (/23503|foreign key|violates.*constraint/i.test(detail)) {
        return NextResponse.json({ message: "Este cadastro ainda está ligado a outro registro protegido no Supabase. " + detail }, { status: 409 });
      }
      return NextResponse.json({ message: detail }, { status: response.status });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Não foi possível apagar." }, { status: 502 });
  }
}
