import { NextResponse } from "next/server";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { AdminResource, cleanAdminPayload, getSupabaseAdminConfig, supabaseHeaders } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const resources = new Set<AdminResource>(["niches", "categories", "services"]);

function isResource(value: unknown): value is AdminResource {
  return resources.has(value as AdminResource);
}

async function readError(response: Response) {
  try {
    const payload = await response.json() as { message?: string; details?: string };
    return payload.message || payload.details || "Não foi possível salvar a alteração.";
  } catch {
    return "Não foi possível salvar a alteração.";
  }
}

function configResponse() {
  const config = getSupabaseAdminConfig();
  if (!config.url || !config.key) return { config: null, response: NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 }) };
  return { config, response: null };
}

export async function GET() {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  const { url, key, schema, tables } = resolved.config;
  if (!url || !key) return NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 });
  const load = async (resource: AdminResource) => {
    const response = await fetch(`${url}/rest/v1/${encodeURIComponent(tables[resource])}?select=*`, {
      headers: supabaseHeaders(key, schema),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await readError(response));
    return response.json() as Promise<Array<Record<string, unknown>>>;
  };
  try {
    const [niches, categories, services] = await Promise.all([load("niches"), load("categories"), load("services")]);
    return NextResponse.json({ niches, categories, services }, { headers: { "Cache-Control": "no-store" } });
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
  const { url, key, schema, tables } = resolved.config;
  if (!url || !key) return NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 });
  const payload = cleanAdminPayload(body.resource, body.data);
  if (!payload.name || (body.resource !== "niches" && !payload.niche_id) || (body.resource === "services" && !payload.category_id)) {
    return NextResponse.json({ message: "Preencha os campos obrigatórios." }, { status: 400 });
  }
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(tables[body.resource])}`, {
    method: "POST",
    headers: supabaseHeaders(key, schema, true),
    body: JSON.stringify(payload),
  });
  if (!response.ok) return NextResponse.json({ message: await readError(response) }, { status: response.status });
  return NextResponse.json({ item: (await response.json())[0] }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!await isAdminAuthorized()) return NextResponse.json({ message: "Acesso não autorizado." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { resource?: unknown; id?: unknown; data?: Record<string, unknown> };
  if (!isResource(body.resource) || !body.id || !body.data) return NextResponse.json({ message: "Alteração inválida." }, { status: 400 });
  const resolved = configResponse();
  if (!resolved.config) return resolved.response;
  const { url, key, schema, tables } = resolved.config;
  if (!url || !key) return NextResponse.json({ message: "Supabase ainda não configurado." }, { status: 503 });
  const payload = cleanAdminPayload(body.resource, body.data);
  const response = await fetch(`${url}/rest/v1/${encodeURIComponent(tables[body.resource])}?id=eq.${encodeURIComponent(String(body.id))}`, {
    method: "PATCH",
    headers: supabaseHeaders(key, schema, true),
    body: JSON.stringify(payload),
  });
  if (!response.ok) return NextResponse.json({ message: await readError(response) }, { status: response.status });
  return NextResponse.json({ item: (await response.json())[0] });
}
