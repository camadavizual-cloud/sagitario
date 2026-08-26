"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type BillingType = "monthly" | "one_time" | "setup";
type Niche = { id: string; name: string };
type Category = { id: string; name: string; nicheId: string | null; order: number };
type Service = { id: string; name: string; description: string; categoryId: string | null; nicheIds: string[]; unit: string; billingType: BillingType; price: number; defaultQuantity: number; minQuantity: number; maxQuantity: number | null };
type Company = { name: string; logoUrl: string | null; document: string; email: string; phone: string; address: string };
type Catalog = { niches: Niche[]; categories: Category[]; services: Service[]; company: Company | null };
type Selection = Record<string, number>;
type Conditions = { client: string; responsible: string; email: string; phone: string; validity: string; start: string; term: string; payment: string; dueDay: string; notes: string };

const initialConditions: Conditions = { client:"", responsible:"", email:"", phone:"", validity:"15 dias", start:"", term:"3 meses", payment:"Pix ou boleto", dueDay:"10", notes:"" };
const currency = new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" });
const formatMoney = (value: number) => currency.format(Number.isFinite(value) ? value : 0);
const MONTHLY_PLAN_RATE = 0.4;

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "sagitarioBrand sagitarioBrandCompact" : "sagitarioBrand"} aria-label="Sagitário"><Image src="/sagitario-full-logo.png" alt="" width={1994} height={789} priority /></div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "field fieldWide" : "field"}><span>{label}</span>{children}</label>;
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [nicheId, setNicheId] = useState("");
  const [selection, setSelection] = useState<Selection>({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [conditions, setConditions] = useState<Conditions>(initialConditions);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/catalog", { cache:"no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message || "Não foi possível carregar os dados.");
      return payload as Catalog;
    }).then((payload) => {
      if (!active) return;
      setLoadError(null);
      setCatalog(payload);
      setNicheId(payload.niches[0]?.id || "");
    }).catch((error: Error) => {
      if (!active) return;
      setLoadError(error.message);
      retryTimer = setTimeout(() => {
        if (!active) return;
        setLoading(true);
        setReloadKey((current) => current + 1);
      }, 6000);
    }).finally(() => active && setLoading(false));
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [reloadKey]);

  const servicesById = useMemo(() => new Map((catalog?.services || []).map((service) => [service.id, service])), [catalog]);
  const nicheServices = useMemo(() => (catalog?.services || []).filter((service) => service.nicheIds.length === 0 || service.nicheIds.includes(nicheId)), [catalog, nicheId]);
  const nicheCategories = useMemo(() => {
    const used = new Set(nicheServices.map((service) => service.categoryId).filter(Boolean));
    return (catalog?.categories || []).filter((category) => (!category.nicheId || category.nicheId === nicheId) && used.has(category.id)).sort((a,b) => a.order - b.order || a.name.localeCompare(b.name));
  }, [catalog, nicheId, nicheServices]);
  const selectedServices = useMemo(() => Object.entries(selection).map(([id, quantity]) => ({ service:servicesById.get(id), quantity })).filter((item): item is { service:Service; quantity:number } => Boolean(item.service)), [selection, servicesById]);
  const setupTotal = useMemo(() => selectedServices.reduce((sum, { service, quantity }) => service.billingType === "setup" ? sum + service.price * quantity : sum, 0), [selectedServices]);
  const serviceReferenceTotal = useMemo(() => selectedServices.reduce((sum, { service, quantity }) => service.billingType === "setup" ? sum : sum + service.price * quantity, 0), [selectedServices]);
  const monthlyPlanTotal = serviceReferenceTotal * MONTHLY_PLAN_RATE;

  const filteredServices = useMemo(() => nicheServices.filter((service) => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !query || `${service.name} ${service.description} ${service.unit}`.toLocaleLowerCase("pt-BR").includes(query);
    return matchesSearch && (categoryFilter === "all" || service.categoryId === categoryFilter);
  }), [nicheServices, search, categoryFilter]);

  const groupedServices = useMemo(() => {
    const groups = nicheCategories.map((category) => ({ category, services:filteredServices.filter((service) => service.categoryId === category.id) })).filter((group) => group.services.length);
    const uncategorized = filteredServices.filter((service) => !service.categoryId || !nicheCategories.some((category) => category.id === service.categoryId));
    if (uncategorized.length) groups.push({ category:{ id:"other", name:"Outros serviços", nicheId:null, order:999 }, services:uncategorized });
    return groups;
  }, [filteredServices, nicheCategories]);

  const setCondition = (field: keyof Conditions, value: string) => setConditions((current) => ({ ...current, [field]:value }));
  const toggleService = (service: Service) => {
    setSelection((current) => { if (current[service.id] !== undefined) { const next = { ...current }; delete next[service.id]; return next; } return { ...current, [service.id]:service.defaultQuantity }; });
    setValidationMessage("");
  };
  const changeQuantity = (service: Service, delta: number) => setSelection((current) => {
    if (current[service.id] === undefined) return current;
    const upper = service.maxQuantity ?? Number.MAX_SAFE_INTEGER;
    return { ...current, [service.id]:Math.min(upper, Math.max(service.minQuantity, current[service.id] + delta)) };
  });
  const changeNiche = (nextNicheId: string) => {
    if (nextNicheId === nicheId) return;
    const compatible = new Set((catalog?.services || []).filter((service) => service.nicheIds.length === 0 || service.nicheIds.includes(nextNicheId)).map((service) => service.id));
    const incompatible = Object.keys(selection).filter((id) => !compatible.has(id));
    if (incompatible.length && !window.confirm("A mudança de nicho removerá serviços incompatíveis da seleção. Deseja continuar?")) return;
    setSelection((current) => Object.fromEntries(Object.entries(current).filter(([id]) => compatible.has(id))));
    setNicheId(nextNicheId); setCategoryFilter("all"); setValidationMessage("");
  };
  const clearSelection = () => {
    if (selectedServices.length && !window.confirm("Limpar todos os serviços e condições desta proposta?")) return;
    setSelection({}); setConditions(initialConditions); setSearch(""); setCategoryFilter("all"); setValidationMessage("");
  };
  const openReview = () => {
    if (!selectedServices.length) { setValidationMessage("Selecione pelo menos um serviço para gerar a proposta."); window.scrollTo({ top:0, behavior:"smooth" }); return; }
    setValidationMessage(""); setReviewOpen(true); setMobileSummaryOpen(false);
  };

  const currentNiche = catalog?.niches.find((niche) => niche.id === nicheId) || null;
  const renderSummary = (modal = false) => <>
    <div className="summaryHeading"><div><span className="eyebrow">Resumo</span><h2>{selectedServices.length ? `${selectedServices.length} ${selectedServices.length === 1 ? "serviço" : "serviços"}` : "Sua seleção"}</h2></div>{modal && <button className="iconButton" onClick={() => setMobileSummaryOpen(false)} aria-label="Fechar resumo">×</button>}</div>
    {selectedServices.length ? <div className="cleanPriceStack"><div className="selectedMonthlyTotal"><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div><div className="recurrenceTotal"><span>Condição especial de recorrência</span><strong>{formatMoney(monthlyPlanTotal)}<small>/mês</small></strong></div>{setupTotal > 0 && <div className="setupTotal"><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></div>}</div> : <p className="emptyCompact">Selecione os serviços para comparar os valores.</p>}
    <button className="primaryButton full" onClick={openReview}>Gerar proposta</button>
  </>;

  if (loading) return <main className="statePage"><div className="loader" /><h1>Carregando o Sagitário…</h1><p>Buscando nichos e serviços.</p></main>;
  if (loadError) return <main className="statePage configState"><Brand /><span className="statusBadge">Reconectando</span><h1>Conexão temporariamente indisponível</h1><p>{loadError}</p><button className="primaryButton" onClick={() => { setLoadError(null); setLoading(true); setReloadKey((current) => current + 1); }}>Tentar novamente</button><small>O Sagitário tentará reconectar automaticamente em alguns segundos.</small></main>;
  if (!catalog) return null;

  return <>
    <main className="appShell">
      <header className="topbar"><Brand /><div className="headerActions"><a id="sagitario-admin-v4" className="adminButton desktopAdminLink" href={ADMIN_URL} target="_self" aria-label="Abrir administração do Sagitário"><span aria-hidden="true">⚙</span> Admin</a><button className="secondaryButton" onClick={clearSelection}>Limpar seleção</button></div></header>
      {validationMessage && <div className="validationBanner" role="alert">{validationMessage}</div>}
      <section className="nicheSection" aria-labelledby="niche-title"><div><span className="stepNumber">01</span><div><h2 id="niche-title">Escolha o nicho</h2><p>Os serviços disponíveis se adaptam à escolha.</p></div></div><div className="nicheButtons" role="group" aria-label="Nichos">{catalog.niches.map((niche) => <button key={niche.id} onClick={() => changeNiche(niche.id)} className={niche.id === nicheId ? "active" : ""}>{niche.name}</button>)}</div></section>
      <nav className="mobileQuickNav" aria-label="Atalhos da proposta"><a href="#services">Serviços <b>{selectedServices.length}</b></a><a href="#comparison">Comparar</a><a id="sagitario-admin-mobile-v4" className="adminQuickLink" href={ADMIN_URL} target="_self" aria-label="Abrir administração do Sagitário">⚙ Admin</a></nav>
      <div className="workspaceGrid">
        <div className="mainColumn">
          <section className="sectionBlock servicesSection" id="services" aria-labelledby="services-title">
            <div className="sectionTitle"><span className="stepNumber">02</span><div><h2 id="services-title">Lista de serviços</h2><p>Marque, ajuste a quantidade e acompanhe o subtotal.</p></div></div>
            <div className="filtersBar"><label className="searchField"><span className="srOnly">Pesquisar serviços</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar serviço" /></label><select aria-label="Filtrar por categoria" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">Todas as categorias</option>{nicheCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
            {groupedServices.length ? groupedServices.map(({ category, services }) => <div className="serviceGroup" key={category.id}><h3>{category.name}<span>{services.length}</span></h3><div className="serviceList">{services.map((service) => {
              const checked = selection[service.id] !== undefined; const quantity = selection[service.id] ?? service.defaultQuantity;
              return <article key={service.id} className={checked ? "serviceRow selected" : "serviceRow"}><label className="checkWrap"><input type="checkbox" checked={checked} onChange={() => toggleService(service)} /><span className="customCheck" /></label><div className="serviceInfo" role="button" tabIndex={0} aria-pressed={checked} onClick={() => toggleService(service)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleService(service); } }}><div className="serviceNameLine"><h4>{service.name}</h4>{service.billingType === "setup" && <span className="billingTag setup">Taxa inicial</span>}</div>{service.description && <p>{service.description}</p>}<small>{formatMoney(service.price)} por {service.unit}</small></div><div className="quantityControl" aria-label={`Quantidade de ${service.name}`}><button disabled={!checked || quantity <= service.minQuantity} onClick={() => changeQuantity(service,-1)} aria-label="Diminuir quantidade">−</button><output>{quantity}</output><button disabled={!checked || (service.maxQuantity !== null && quantity >= service.maxQuantity)} onClick={() => changeQuantity(service,1)} aria-label="Aumentar quantidade">+</button></div><div className="subtotal"><span>Subtotal</span><strong>{formatMoney(checked ? service.price * quantity : 0)}</strong></div></article>;
            })}</div></div>) : <div className="emptyState"><strong>Nenhum serviço encontrado.</strong><span>Ajuste os filtros ou confira o cadastro deste nicho.</span></div>}
          </section>

          <section className="sectionBlock comparisonSection" id="comparison" aria-labelledby="comparison-title">
            <div className="sectionTitle"><span className="stepNumber">03</span><div><h2 id="comparison-title">Pontual × recorrência</h2><p>Compare o valor real com a condição especial de recorrência.</p></div></div>
            <div className="comparisonGrid">
              <article className="comparisonCard separated"><span className="eyebrow">Contratação pontual</span><h3>Valor do plano</h3><div className="priceReveal selectedPrice"><span>Valor integral</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div>{setupTotal > 0 && <div className="comparisonNote"><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></div>}</article>
              <article className="comparisonCard monthlyPlanCard"><span className="eyebrow red">Condição especial</span><h3>Recorrência mensal</h3><div className="priceReveal planPrice"><span>Valor mensal</span><strong>{formatMoney(monthlyPlanTotal)}</strong><small>por mês</small></div>{serviceReferenceTotal > 0 ? <div className="includedNotice">Serviços selecionados incluídos</div> : <div className="scopeNotice">Selecione os serviços para ver o valor.</div>}{setupTotal > 0 && <div className="comparisonNote"><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></div>}</article>
            </div>
          </section>

          <details className="sectionBlock conditionsSection conditionsDisclosure" id="conditions">
            <summary><div><span className="stepNumber">04</span><div><h2>Dados da proposta</h2><p>Opcional</p></div></div><span className="expandLabel" aria-hidden="true" /></summary>
            <div className="conditionsBody"><div className="subsectionLabel">Identificação</div><div className="fieldsGrid identificationGrid"><Field label="Nome ou empresa"><input value={conditions.client} onChange={(e) => setCondition("client",e.target.value)} placeholder="Ex.: Empresa X" /></Field><Field label="Responsável"><input value={conditions.responsible} onChange={(e) => setCondition("responsible",e.target.value)} placeholder="Nome do contato" /></Field><Field label="E-mail"><input type="email" value={conditions.email} onChange={(e) => setCondition("email",e.target.value)} placeholder="contato@empresa.com" /></Field><Field label="Telefone"><input value={conditions.phone} onChange={(e) => setCondition("phone",e.target.value)} placeholder="(00) 00000-0000" /></Field></div><div className="subsectionLabel">Condições</div><div className="fieldsGrid conditionsGrid"><Field label="Validade"><input value={conditions.validity} onChange={(e) => setCondition("validity",e.target.value)} /></Field><Field label="Previsão de início"><input type="date" value={conditions.start} onChange={(e) => setCondition("start",e.target.value)} /></Field><Field label="Vigência"><input value={conditions.term} onChange={(e) => setCondition("term",e.target.value)} /></Field><Field label="Forma de pagamento"><input value={conditions.payment} onChange={(e) => setCondition("payment",e.target.value)} /></Field><Field label="Dia de vencimento"><input type="number" min="1" max="31" value={conditions.dueDay} onChange={(e) => setCondition("dueDay",e.target.value)} /></Field><Field label="Observações" wide><textarea value={conditions.notes} onChange={(e) => setCondition("notes",e.target.value)} placeholder="Detalhes importantes para esta proposta." /></Field></div></div>
          </details>
        </div>
        <aside className="summaryPanel">{renderSummary()}</aside>
      </div>
    </main>

    <div className="mobileBottomBar"><div><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div><button onClick={() => setMobileSummaryOpen(true)}>Ver resumo{selectedServices.length ? ` · ${selectedServices.length}` : ""}</button></div>
    {mobileSummaryOpen && <div className="overlay mobileSummaryOverlay" onMouseDown={(e) => e.target === e.currentTarget && setMobileSummaryOpen(false)}><aside className="mobileSummary">{renderSummary(true)}</aside></div>}
    {reviewOpen && <div className="overlay reviewOverlay" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(e) => e.target === e.currentTarget && setReviewOpen(false)}><div className="reviewModal screenOnly"><div className="reviewHeader"><div><span className="eyebrow red">Revisão final</span><h2 id="review-title">Confira antes de gerar o PDF</h2></div><button className="iconButton" onClick={() => setReviewOpen(false)} aria-label="Fechar revisão">×</button></div><div className="reviewBody"><div className="reviewMeta"><div><span>Nicho</span><strong>{currentNiche?.name || "—"}</strong></div>{conditions.client && <div><span>Proposta para</span><strong>{conditions.client}</strong></div>}<div><span>Validade</span><strong>{conditions.validity || "—"}</strong></div></div><div className="reviewTable"><div className="reviewTableHead"><span>Serviço</span><span>Qtd.</span><span>Subtotal</span></div>{selectedServices.map(({ service,quantity }) => <div className="reviewTableRow" key={service.id}><span>{service.name}</span><span>{quantity}</span><strong>{formatMoney(service.price * quantity)}</strong></div>)}</div><div className="reviewTotals"><div className="reviewFullValue"><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div><div><span>Condição especial de recorrência</span><strong>{formatMoney(monthlyPlanTotal)}/mês</strong></div>{setupTotal > 0 && <div><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></div>}</div></div><div className="reviewActions"><button className="secondaryButton" onClick={() => setReviewOpen(false)}>Voltar e corrigir</button><button className="primaryButton" onClick={() => window.print()}>Baixar / imprimir em PDF</button></div></div></div>}

    <article className="printProposal"><header className="printHeader"><Brand compact /><div><span>PROPOSTA COMERCIAL</span><h1>{conditions.client || "Proposta de serviços"}</h1><p>{currentNiche?.name || ""}</p></div></header>{(conditions.client || conditions.responsible || conditions.email || conditions.phone) && <section className="printIdentification"><h2>Identificação</h2><div>{conditions.client && <p><span>Nome ou empresa</span><strong>{conditions.client}</strong></p>}{conditions.responsible && <p><span>Responsável</span><strong>{conditions.responsible}</strong></p>}{conditions.email && <p><span>E-mail</span><strong>{conditions.email}</strong></p>}{conditions.phone && <p><span>Telefone</span><strong>{conditions.phone}</strong></p>}</div></section>}<section><h2>Serviços selecionados</h2><table><thead><tr><th>Serviço</th><th>Qtd.</th><th>Unidade</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>{selectedServices.map(({ service,quantity }) => <tr key={service.id}><td>{service.name}</td><td>{quantity}</td><td>{service.unit}</td><td>{formatMoney(service.price)}</td><td>{formatMoney(service.price * quantity)}</td></tr>)}</tbody></table><div className="printTotals"><p className="printFullValue"><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></p><p><span>Condição especial de recorrência</span><strong>{formatMoney(monthlyPlanTotal)}</strong></p>{setupTotal > 0 && <p><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></p>}</div></section>{serviceReferenceTotal > 0 && <section><h2>Condição especial de recorrência</h2><div className="printPlan"><div><span>Valor mensal</span><strong>{formatMoney(monthlyPlanTotal)}/mês</strong></div>{setupTotal > 0 && <div><span>Taxa inicial à parte</span><strong>{formatMoney(setupTotal)}</strong></div>}</div></section>}<section><h2>Condições comerciais</h2><div className="printConditions"><p><span>Validade</span><strong>{conditions.validity || "—"}</strong></p><p><span>Previsão de início</span><strong>{conditions.start ? new Date(`${conditions.start}T12:00:00`).toLocaleDateString("pt-BR") : "A combinar"}</strong></p><p><span>Vigência</span><strong>{conditions.term || "—"}</strong></p><p><span>Pagamento</span><strong>{conditions.payment || "—"}</strong></p><p><span>Vencimento</span><strong>{conditions.dueDay ? `Dia ${conditions.dueDay}` : "—"}</strong></p></div>{conditions.notes && <div className="printNotes"><span>Observações</span><p>{conditions.notes}</p></div>}</section><footer>Sagitário · Frame Rec{catalog.company?.email ? ` · ${catalog.company.email}` : ""}{catalog.company?.phone ? ` · ${catalog.company.phone}` : ""}</footer></article>
  </>;
}
