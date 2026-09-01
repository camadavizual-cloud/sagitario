"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Niche = { id: string; name: string; slug: string; active: boolean };
type Category = { id: string; niche_id: string; name: string; sort_order: number; active: boolean };
type Service = { id: string; niche_id: string; category_id: string; name: string; description: string; unit: string; billing_type: "monthly" | "one_time" | "setup"; price: number; default_quantity: number; min_quantity: number; max_quantity: number | null; active: boolean };
type AdminCatalog = { niches: Niche[]; categories: Category[]; services: Service[] };
type SeedSummary = { addedServices?: number };
type Resource = keyof AdminCatalog;

const blankNiche: Omit<Niche, "id"> = { name: "", slug: "", active: true };
const blankCategory: Omit<Category, "id"> = { niche_id: "", name: "", sort_order: 0, active: true };
const blankService: Omit<Service, "id"> = { niche_id: "", category_id: "", name: "", description: "", unit: "unidade", billing_type: "one_time", price: 0, default_quantity: 1, min_quantity: 1, max_quantity: null, active: true };
const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const slugify = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

function Brand() {
  return <Link href="/" className="adminBrand" aria-label="Voltar ao Sagitário"><Image src="/sagitario-full-logo.png" alt="Sagitário" width={1994} height={789} priority /></Link>;
}

export default function AdminPage() {
  const [session, setSession] = useState<"checking" | "login" | "ready">("checking");
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [catalog, setCatalog] = useState<AdminCatalog>({ niches: [], categories: [], services: [] });
  const [section, setSection] = useState<Resource>("services");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [nicheForm, setNicheForm] = useState<Omit<Niche, "id"> & { id?: string }>({ ...blankNiche });
  const [categoryForm, setCategoryForm] = useState<Omit<Category, "id"> & { id?: string }>({ ...blankCategory });
  const [serviceForm, setServiceForm] = useState<Omit<Service, "id"> & { id?: string }>({ ...blankService });

  const loadCatalog = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/catalog", { cache: "no-store" });
      const payload = await response.json();
      if (response.status === 401) { setSession("login"); return; }
      if (!response.ok) throw new Error(payload.message || "Não foi possível carregar os cadastros.");
      setCatalog({
        niches: [...payload.niches].sort((a: Niche,b: Niche) => a.name.localeCompare(b.name)),
        categories: [...payload.categories].sort((a: Category,b: Category) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
        services: [...payload.services].sort((a: Service,b: Service) => a.name.localeCompare(b.name)),
      });
      const seeded = payload.seeded as SeedSummary | undefined;
      if (seeded?.addedServices) setMessage(`${seeded.addedServices} serviços de Clínicas foram adicionados ao catálogo.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Falha ao carregar."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/admin/session", { cache: "no-store" }).then((response) => response.json()).then((payload) => {
      setConfigured(Boolean(payload.configured));
      setSession(payload.authenticated ? "ready" : "login");
      if (payload.authenticated) void loadCatalog();
    }).catch(() => { setSession("login"); setError("Não foi possível verificar o acesso."); });
  }, [loadCatalog]);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    const response = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const payload = await response.json();
    setLoading(false);
    if (!response.ok) { setError(payload.message || "Não foi possível entrar."); return; }
    setPassword(""); setSession("ready"); void loadCatalog();
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setSession("login"); setCatalog({ niches: [], categories: [], services: [] });
  };

  const save = async (resource: Resource, data: Record<string, unknown>, id?: string) => {
    setLoading(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/catalog", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource, id, data }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Não foi possível salvar.");
      setMessage(id ? "Alteração salva." : "Cadastro adicionado.");
      if (resource === "niches") setNicheForm({ ...blankNiche });
      if (resource === "categories") setCategoryForm({ ...blankCategory });
      if (resource === "services") setServiceForm({ ...blankService });
      await loadCatalog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar."); }
    finally { setLoading(false); }
  };

  const toggleActive = async (resource: Resource, item: Niche | Category | Service) => {
    if (!window.confirm(`${item.active ? "Desativar" : "Ativar"} “${item.name}”?`)) return;
    await save(resource, { ...item, active: !item.active }, item.id);
  };

  const remove = async (resource: Resource, item: Niche | Category | Service) => {
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Não foi possível apagar.");
      setMessage("Cadastro apagado permanentemente.");
      if (resource === "niches" && nicheForm.id === item.id) setNicheForm({ ...blankNiche });
      if (resource === "categories" && categoryForm.id === item.id) setCategoryForm({ ...blankCategory });
      if (resource === "services" && serviceForm.id === item.id) setServiceForm({ ...blankService });
      await loadCatalog();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível apagar."); }
    finally { setLoading(false); }
  };

  const categoriesForService = useMemo(() => catalog.categories.filter((category) => !serviceForm.niche_id || category.niche_id === serviceForm.niche_id), [catalog.categories, serviceForm.niche_id]);
  const nicheName = (id: string) => catalog.niches.find((item) => item.id === id)?.name || "Nicho não encontrado";
  const categoryName = (id: string) => catalog.categories.find((item) => item.id === id)?.name || "Sem categoria";

  if (session === "checking") return <main className="adminState"><div className="loader" /><p>Verificando acesso…</p></main>;
  if (session === "login") return <main className="adminLoginPage"><section className="adminLoginCard"><Brand /><span className="adminEyebrow">Área restrita</span><h1>Administração</h1><p>Gerencie os serviços exibidos no montador.</p>{!configured ? <div className="adminSetupNotice"><strong>Configuração necessária</strong><span>Cadastre a variável <code>ADMIN_PASSWORD</code> na Hostinger e reimplante o Site.</span></div> : <form onSubmit={login}><label>Senha administrativa<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required autoFocus /></label><button className="primaryButton" disabled={loading}>{loading ? "Entrando…" : "Entrar"}</button></form>}{error && <p className="adminError" role="alert">{error}</p>}<Link href="/" className="adminBackLink">← Voltar ao montador</Link></section></main>;

  return <main className="adminShell">
    <header className="adminTopbar"><Brand /><div className="adminHeaderActions"><Link href="https://sagitario.camadavisual.com.br/" className="secondaryButton adminLinkButton">Abrir montador</Link><button className="adminLogout" onClick={logout}>Sair</button></div></header>
    <section className="adminIntro"><div><span className="adminEyebrow">Sagitário</span><h1>Administração</h1><p>Cadastre e organize o catálogo usado nas propostas.</p></div><div className="adminCounts"><span><b>{catalog.niches.length}</b> nichos</span><span><b>{catalog.categories.length}</b> categorias</span><span><b>{catalog.services.length}</b> serviços</span></div></section>
    <nav className="adminTabs" aria-label="Seções administrativas">
      <button className={section === "services" ? "active" : ""} onClick={() => setSection("services")}>Serviços</button>
      <button className={section === "categories" ? "active" : ""} onClick={() => setSection("categories")}>Categorias</button>
      <button className={section === "niches" ? "active" : ""} onClick={() => setSection("niches")}>Nichos</button>
    </nav>
    {(error || message) && <div className={error ? "adminNotice error" : "adminNotice success"} role="status">{error || message}</div>}

    {section === "niches" && <section className="adminWorkspace">
      <form className="adminForm" onSubmit={(event) => { event.preventDefault(); void save("niches", nicheForm, nicheForm.id); }}><div className="adminFormTitle"><div><span>Cadastro</span><h2>{nicheForm.id ? "Editar nicho" : "Novo nicho"}</h2></div>{nicheForm.id && <button type="button" onClick={() => setNicheForm({ ...blankNiche })}>Cancelar</button>}</div><label>Nome<input required value={nicheForm.name} onChange={(event) => setNicheForm((current) => ({ ...current, name: event.target.value, slug: current.id ? current.slug : slugify(event.target.value) }))} /></label><label>Identificador<input required value={nicheForm.slug} onChange={(event) => setNicheForm((current) => ({ ...current, slug: slugify(event.target.value) }))} /></label><label className="adminCheck"><input type="checkbox" checked={nicheForm.active} onChange={(event) => setNicheForm((current) => ({ ...current, active: event.target.checked }))} /> Ativo</label><button className="primaryButton" disabled={loading}>{nicheForm.id ? "Salvar alterações" : "Adicionar nicho"}</button></form>
      <div className="adminList"><div className="adminListHeader"><h2>Nichos</h2><span>{catalog.niches.length} cadastrados</span></div>{catalog.niches.map((item) => <article className={!item.active ? "adminRow inactive" : "adminRow"} key={item.id}><div><h3>{item.name}</h3><p>{item.slug}</p></div><span className={item.active ? "status active" : "status"}>{item.active ? "Ativo" : "Inativo"}</span><div className="adminRowActions"><button onClick={() => setNicheForm({ ...item })}>Editar</button><button onClick={() => void toggleActive("niches", item)}>{item.active ? "Desativar" : "Ativar"}</button><button className="dangerAction" onClick={() => void remove("niches", item)}>Apagar</button></div></article>)}</div>
    </section>}

    {section === "categories" && <section className="adminWorkspace">
      <form className="adminForm" onSubmit={(event) => { event.preventDefault(); void save("categories", categoryForm, categoryForm.id); }}><div className="adminFormTitle"><div><span>Cadastro</span><h2>{categoryForm.id ? "Editar categoria" : "Nova categoria"}</h2></div>{categoryForm.id && <button type="button" onClick={() => setCategoryForm({ ...blankCategory })}>Cancelar</button>}</div><label>Nicho<select required value={categoryForm.niche_id} onChange={(event) => setCategoryForm((current) => ({ ...current, niche_id: event.target.value }))}><option value="">Selecione</option>{catalog.niches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Nome<input required value={categoryForm.name} onChange={(event) => setCategoryForm((current) => ({ ...current, name: event.target.value }))} /></label><label>Ordem<input type="number" min="0" value={categoryForm.sort_order} onChange={(event) => setCategoryForm((current) => ({ ...current, sort_order: Number(event.target.value) }))} /></label><label className="adminCheck"><input type="checkbox" checked={categoryForm.active} onChange={(event) => setCategoryForm((current) => ({ ...current, active: event.target.checked }))} /> Ativa</label><button className="primaryButton" disabled={loading}>{categoryForm.id ? "Salvar alterações" : "Adicionar categoria"}</button></form>
      <div className="adminList"><div className="adminListHeader"><h2>Categorias</h2><span>{catalog.categories.length} cadastradas</span></div>{catalog.categories.map((item) => <article className={!item.active ? "adminRow inactive" : "adminRow"} key={item.id}><div><h3>{item.name}</h3><p>{nicheName(item.niche_id)} · Ordem {item.sort_order}</p></div><span className={item.active ? "status active" : "status"}>{item.active ? "Ativa" : "Inativa"}</span><div className="adminRowActions"><button onClick={() => setCategoryForm({ ...item })}>Editar</button><button onClick={() => void toggleActive("categories", item)}>{item.active ? "Desativar" : "Ativar"}</button><button className="dangerAction" onClick={() => void remove("categories", item)}>Apagar</button></div></article>)}</div>
    </section>}

    {section === "services" && <section className="adminWorkspace servicesAdminWorkspace">
      <form className="adminForm adminServiceForm" onSubmit={(event) => { event.preventDefault(); void save("services", serviceForm, serviceForm.id); }}><div className="adminFormTitle"><div><span>Cadastro</span><h2>{serviceForm.id ? "Editar serviço" : "Novo serviço"}</h2></div>{serviceForm.id && <button type="button" onClick={() => setServiceForm({ ...blankService })}>Cancelar</button>}</div><div className="adminFormGrid"><label>Nicho<select required value={serviceForm.niche_id} onChange={(event) => setServiceForm((current) => ({ ...current, niche_id: event.target.value, category_id: "" }))}><option value="">Selecione</option>{catalog.niches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Categoria<select required value={serviceForm.category_id} onChange={(event) => setServiceForm((current) => ({ ...current, category_id: event.target.value }))}><option value="">Selecione</option>{categoriesForService.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="adminSpan2">Nome<input required value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} /></label><label className="adminSpan2">Descrição<textarea value={serviceForm.description} onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))} /></label><label>Unidade<input required value={serviceForm.unit} onChange={(event) => setServiceForm((current) => ({ ...current, unit: event.target.value }))} /></label><label>Tipo de cobrança<select value={serviceForm.billing_type} onChange={(event) => setServiceForm((current) => ({ ...current, billing_type: event.target.value as Service["billing_type"] }))}><option value="one_time">Pontual</option><option value="monthly">Mensal</option><option value="setup">Taxa inicial</option></select></label><label>Valor unitário<input type="number" min="0" step="0.01" required value={serviceForm.price} onChange={(event) => setServiceForm((current) => ({ ...current, price: Number(event.target.value) }))} /></label><label>Quantidade padrão<input type="number" min="1" required value={serviceForm.default_quantity} onChange={(event) => setServiceForm((current) => ({ ...current, default_quantity: Number(event.target.value) }))} /></label><label>Quantidade mínima<input type="number" min="1" required value={serviceForm.min_quantity} onChange={(event) => setServiceForm((current) => ({ ...current, min_quantity: Number(event.target.value) }))} /></label><label>Quantidade máxima<input type="number" min="1" value={serviceForm.max_quantity ?? ""} placeholder="Sem limite" onChange={(event) => setServiceForm((current) => ({ ...current, max_quantity: event.target.value ? Number(event.target.value) : null }))} /></label></div><label className="adminCheck"><input type="checkbox" checked={serviceForm.active} onChange={(event) => setServiceForm((current) => ({ ...current, active: event.target.checked }))} /> Serviço ativo</label><button className="primaryButton" disabled={loading}>{serviceForm.id ? "Salvar alterações" : "Adicionar serviço"}</button></form>
      <div className="adminList adminServiceList"><div className="adminListHeader"><h2>Serviços</h2><span>{catalog.services.length} cadastrados</span></div>{catalog.services.map((item) => <article className={!item.active ? "adminRow serviceAdminRow inactive" : "adminRow serviceAdminRow"} key={item.id}><div><h3>{item.name}</h3><p>{nicheName(item.niche_id)} · {categoryName(item.category_id)}</p><strong>{currency.format(Number.isFinite(Number(item.price)) ? Number(item.price) : 0)} / {item.unit}</strong></div><span className={item.active ? "status active" : "status"}>{item.active ? "Ativo" : "Inativo"}</span><div className="adminRowActions"><button onClick={() => { setServiceForm({ ...item }); window.scrollTo({ top: 150, behavior: "smooth" }); }}>Editar</button><button onClick={() => void toggleActive("services", item)}>{item.active ? "Desativar" : "Ativar"}</button><button className="dangerAction" onClick={() => void remove("services", item)}>Apagar</button></div></article>)}</div>
    </section>}
  </main>;
}
