"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Niche = { id: string; name: string; slug: string; description?: string; active: boolean };
type Service = { id: string; niche_id: string; name: string; description: string; unit: string; billing_type: "monthly" | "one_time" | "setup"; price: number; default_quantity: number; min_quantity: number; max_quantity: number | null; active: boolean };
type AdminCatalog = { niches: Niche[]; services: Service[] };
type SeedSummary = { addedServices?: number };
type Resource = keyof AdminCatalog;
type JsonObject = Record<string, unknown>;

const blankNiche: Omit<Niche, "id"> = { name: "", slug: "", description: "", active: true };
const blankService: Omit<Service, "id"> = { niche_id: "", name: "", description: "", unit: "unidade", billing_type: "one_time", price: 0, default_quantity: 1, min_quantity: 1, max_quantity: null, active: true };
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const textValue = (value: unknown, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;
const listValue = <T extends object>(value: unknown): T[] => Array.isArray(value)
  ? value.filter((item): item is T => Boolean(item && typeof item === "object"))
  : [];
const sortedNamedList = <T extends { name?: unknown }>(value: unknown): T[] => listValue<T>(value)
  .sort((left, right) => textValue(left.name).localeCompare(textValue(right.name), "pt-BR"));
async function readJson(response: Response): Promise<JsonObject> {
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function Brand() {
  return <Link href="/" className="adminBrand" aria-label="Voltar ao Sagitário"><Image src="/sagitario-full-logo.png" alt="Sagitário" width={1994} height={789} priority /></Link>;
}

export default function AdminPage() {
  const [session, setSession] = useState<"checking" | "login" | "ready">("checking");
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [catalog, setCatalog] = useState<AdminCatalog>({ niches: [], services: [] });
  const [section, setSection] = useState<Resource>("services");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [nicheForm, setNicheForm] = useState<Omit<Niche, "id"> & { id?: string }>({ ...blankNiche });
  const [serviceForm, setServiceForm] = useState<Omit<Service, "id"> & { id?: string }>({ ...blankService });

  const loadCatalog = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/catalog", { cache: "no-store" });
      const payload = await readJson(response);
      if (response.status === 401) { setSession("login"); return; }
      if (!response.ok) throw new Error(textValue(payload.message, "Não foi possível carregar os cadastros."));
      setCatalog({
        niches: sortedNamedList<Niche>(payload.niches),
        services: sortedNamedList<Service>(payload.services),
      });
      const seeded = payload.seeded && typeof payload.seeded === "object" ? payload.seeded as SeedSummary : undefined;
      if (seeded?.addedServices) setMessage(`${seeded.addedServices} serviços de Clínicas foram adicionados ao catálogo.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao carregar."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" }).then(readJson).then((payload) => {
      setConfigured(Boolean(payload.configured));
      setSession(payload.authenticated ? "ready" : "login");
      if (payload.authenticated) void loadCatalog();
    }).catch(() => { setSession("login"); setError("Não foi possível verificar o acesso."); });
  }, [loadCatalog]);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const payload = await readJson(response);
    setLoading(false);
    if (!response.ok) { setError(textValue(payload.message, "Não foi possível entrar.")); return; }
    setPassword(""); setSession("ready"); void loadCatalog();
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setSession("login"); setCatalog({ niches: [], services: [] });
  };

  const save = async (resource: Resource, data: Record<string, unknown>, id?: string) => {
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, id, data }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(textValue(payload.message, "Não foi possível salvar."));
      setMessage(id ? "Alteração salva." : "Cadastro adicionado.");
      if (resource === "niches") setNicheForm({ ...blankNiche });
      if (resource === "services") setServiceForm({ ...blankService });
      await loadCatalog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar."); }
    finally { setLoading(false); }
  };

  const toggleActive = async (resource: Resource, item: Niche | Service) => {
    if (!window.confirm(`${item.active ? "Desativar" : "Ativar"} “${item.name}”?`)) return;
    await save(resource, { ...item, active: !item.active }, item.id);
  };

  const remove = async (resource: Resource, item: Niche | Service) => {
    const legacyNotice = resource === "services"
      ? " O vínculo deste serviço com planos antigos também será apagado."
      : resource === "niches"
        ? " Os planos antigos ligados a este nicho e seus itens também serão apagados. Propostas e históricos continuarão protegidos."
        : "";
    if (!window.confirm(`Apagar “${item.name}” permanentemente? Esta ação não pode ser desfeita.${legacyNotice}`)) return;
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, id: item.id }),
      });
      const payload = await readJson(response);
      if (!response.ok) throw new Error(textValue(payload.message, "Não foi possível apagar."));
      setMessage("Cadastro apagado permanentemente.");
      if (resource === "niches" && nicheForm.id === item.id) setNicheForm({ ...blankNiche });
      if (resource === "services" && serviceForm.id === item.id) setServiceForm({ ...blankService });
      await loadCatalog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível apagar."); }
    finally { setLoading(false); }
  };

  const nicheName = (id: string) => id ? (catalog.niches.find((item) => item.id === id)?.name || "Nicho não encontrado") : "Global";

  if (session === "checking") return <main className="adminState"><div className="loader" /><p>Verificando acesso…</p></main>;
  if (session === "login") return <main className="adminLoginPage"><section className="adminLoginCard"><Brand /><span className="adminEyebrow">Área restrita</span><h1>Administração</h1><p>Gerencie os serviços exibidos no montador.</p>{!configured ? <div className="adminSetupNotice"><strong>Configuração necessária</strong><span>Cadastre a variável <code>ADMIN_PASSWORD</code> na Hostinger e reimplante o Site.</span></div> : <form onSubmit={login}><label>Senha administrativa<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></label><button className="primaryButton" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button></form>}{error && <p className="adminError" role="alert">{error}</p>}<Link href="/" className="adminBackLink">← Voltar ao montador</Link></section></main>;

  return <main className="adminShell" data-admin-build="niches-services-v4">
    <header className="adminTopbar"><Brand /><div className="adminHeaderActions"><Link href="https://sagitario.camadavisual.com.br/" className="secondaryButton adminLinkButton">Abrir montador</Link><button className="adminLogout" onClick={logout}>Sair</button></div></header>
    <section className="adminIntro"><div><span className="adminEyebrow">Sagitário</span><h1>Administração</h1><p>Cadastre e organize o catálogo usado nas propostas.</p></div><div className="adminCounts"><span><b>{catalog.niches.length}</b> nichos</span><span><b>{catalog.services.length}</b> serviços</span></div></section>
    <nav className="adminTabs" aria-label="Seções administrativas">
      <button className={section === "services" ? "active" : ""} onClick={() => setSection("services")}>Serviços</button>
      <button className={section === "niches" ? "active" : ""} onClick={() => setSection("niches")}>Nichos</button>
    </nav>
    {(error || message) && <div className={error ? "adminNotice error" : "adminNotice success"} role="status">{error || message}</div>}

    {section === "niches" && <section className="adminWorkspace">
      <form className="adminForm" onSubmit={(event) => { event.preventDefault(); void save("niches", nicheForm, nicheForm.id); }}><div className="adminFormTitle"><div><span>Cadastro</span><h2>{nicheForm.id ? "Editar nicho" : "Novo nicho"}</h2></div>{nicheForm.id && <button type="button" onClick={() => setNicheForm({ ...blankNiche })}>Cancelar</button>}</div><label>Nome<input required value={nicheForm.name} onChange={(event) => setNicheForm((current) => ({ ...current, name: event.target.value, slug: current.id ? current.slug : slugify(event.target.value) }))} /></label><label>Identificador<input required value={nicheForm.slug} onChange={(event) => setNicheForm((current) => ({ ...current, slug: slugify(event.target.value) }))} /></label><label className="adminCheck"><input type="checkbox" checked={nicheForm.active} onChange={(event) => setNicheForm((current) => ({ ...current, active: event.target.checked }))} /> Ativo</label><button className="primaryButton" disabled={loading}>{nicheForm.id ? "Salvar alterações" : "Adicionar nicho"}</button></form>
      <div className="adminList"><div className="adminListHeader"><h2>Nichos</h2><span>{catalog.niches.length} cadastrados</span></div>{catalog.niches.map((item) => <article className={!item.active ? "adminRow inactive" : "adminRow"} key={item.id}><div><h3>{item.name}</h3><p>{item.slug}</p></div><span className={item.active ? "status active" : "status"}>{item.active ? "Ativo" : "Inativo"}</span><div className="adminRowActions"><button onClick={() => setNicheForm({ ...item })}>Editar</button><button onClick={() => void toggleActive("niches", item)}>{item.active ? "Desativar" : "Ativar"}</button><button className="dangerAction" onClick={() => void remove("niches", item)}>Apagar</button></div></article>)}</div>
    </section>}

    {section === "services" && <section className="adminWorkspace servicesAdminWorkspace">
      <form className="adminForm adminServiceForm" onSubmit={(event) => { event.preventDefault(); void save("services", serviceForm, serviceForm.id); }}><div className="adminFormTitle"><div><span>Cadastro</span><h2>{serviceForm.id ? "Editar serviço" : "Novo serviço"}</h2></div>{serviceForm.id && <button type="button" onClick={() => setServiceForm({ ...blankService })}>Cancelar</button>}</div><div className="adminFormGrid"><label className="adminSpan2">Nicho<select required value={serviceForm.niche_id} onChange={(event) => setServiceForm((current) => ({ ...current, niche_id: event.target.value }))}><option value="">Selecione</option>{catalog.niches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="adminSpan2">Nome<input required value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="adminSpan2">Descrição<textarea value={serviceForm.description} onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))} /></label><label>Unidade<input required value={serviceForm.unit} onChange={(event) => setServiceForm((current) => ({ ...current, unit: event.target.value }))} /></label><label>Tipo de cobrança<select value={serviceForm.billing_type} onChange={(event) => setServiceForm((current) => ({ ...current, billing_type: event.target.value as Service["billing_type"] }))}><option value="one_time">Pontual</option><option value="monthly">Mensal</option><option value="setup">Taxa inicial</option></select></label><label>Valor unitário<input type="number" min="0" step="0.01" required value={serviceForm.price} onChange={(event) => setServiceForm((current) => ({ ...current, price: Number(event.target.value) }))} /></label><label>Quantidade padrão<input type="number" min="1" required value={serviceForm.default_quantity} onChange={(event) => setServiceForm((current) => ({ ...current, default_quantity: Number(event.target.value) }))} /></label><label>Quantidade mínima<input type="number" min="1" required value={serviceForm.min_quantity} onChange={(event) => setServiceForm((current) => ({ ...current, min_quantity: Number(event.target.value) }))} /></label><label>Quantidade máxima<input type="number" min="1" value={serviceForm.max_quantity ?? ""} placeholder="Sem limite" onChange={(event) => setServiceForm((current) => ({ ...current, max_quantity: event.target.value ? Number(event.target.value) : null }))} /></label></div><label className="adminCheck"><input type="checkbox" checked={serviceForm.active} onChange={(event) => setServiceForm((current) => ({ ...current, active: event.target.checked }))} /> Serviço ativo</label><button className="primaryButton" disabled={loading}>{serviceForm.id ? "Salvar alterações" : "Adicionar serviço"}</button></form>
      <div className="adminList adminServiceList"><div className="adminListHeader"><h2>Serviços</h2><span>{catalog.services.length} cadastrados</span></div>{catalog.services.map((item) => <article className={!item.active ? "adminRow serviceAdminRow inactive" : "adminRow serviceAdminRow"} key={item.id}><div><h3>{item.name}</h3><p>{nicheName(item.niche_id)}</p><strong>{currency.format(Number.isFinite(Number(item.price)) ? Number(item.price) : 0)} / {item.unit}</strong></div><span className={item.active ? "status active" : "status"}>{item.active ? "Ativo" : "Inativo"}</span><div className="adminRowActions"><button onClick={() => { setServiceForm({ ...item }); window.scrollTo({ top: 150, behavior: "smooth" }); }}>Editar</button><button onClick={() => void toggleActive("services", item)}>{item.active ? "Desativar" : "Ativar"}</button><button className="dangerAction" onClick={() => void remove("services", item)}>Apagar</button></div></article>)}</div>
    </section>}
  </main>;
}
