"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type BillingType = "monthly" | "one_time" | "setup";
type Niche = { id: string; name: string };
type Service = { id: string; name: string; description: string; nicheIds: string[]; unit: string; billingType: BillingType; price: number; defaultQuantity: number; minQuantity: number; maxQuantity: number | null };
type Company = { name: string; logoUrl: string | null; document: string; email: string; phone: string; address: string };
type Catalog = { niches: Niche[]; services: Service[]; company: Company | null };
type Selection = Record<string, number>;
type Conditions = { client: string; document: string; dueDay: string };
type JsonObject = Record<string, unknown>;
type ContractSection = { title: string; paragraphs?: string[]; items?: string[] };

const initialConditions: Conditions = { client:"", document:"", dueDay:"" };
const currency = new Intl.NumberFormat("pt-BR", { style:"currency", currency:"BRL" });
const formatMoney = (value: number) => currency.format(Number.isFinite(value) ? value : 0);
const formatDate = (value: string) => value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "A combinar";
// Keep this destination absolute and versioned so a browser or edge cache
// cannot reuse the former Produframe administration link.
const ADMIN_URL = "https://sagitario.camadavisual.com.br/admin?origem=montador-v5&build=8b91dd8";
const MONTHLY_PLAN_RATE = 0.4;
const contractSections: ContractSection[] = [
  { title: "Observações", paragraphs: [
    "Disponibilidade para produção externa do material de acordo com o que está descrito no plano contratado, com duração de duas horas de produção.",
    "Após esse período, a continuidade da produção do material no local deverá ser acordada entre as partes, ficando a decisão a critério da contratada, assim como o tempo necessário.",
    "O plano contratado tem prazo indeterminado e entende-se por renovação automática. Para realizar o cancelamento, é necessário avisar com 30 (trinta) dias de antecedência; caso contrário, haverá renovação automática até que uma das partes decida pela rescisão imotivada.",
    "Observação 1: a rescisão em prazo inferior a 30 (trinta) dias enseja o pagamento mensal integral, independentemente de qualquer circunstância.",
    "Observação 2: o contrato não tem pausa ou interrupção por férias, viagem, passeio ou qualquer outro motivo, devendo ser paga a quantia acordada no presente contrato.",
  ] },
  { title: "Observações contratuais", items: [
    "O 1º mês de contrato será utilizado para captação e produção dos materiais para uso nas redes sociais da empresa ou marca do cliente, podendo ser reduzido para 15 dias úteis o prazo para início das postagens.",
    "Ressalte-se que o material captado e produzido que não foi postado é de propriedade da produtora e não faz parte do plano. A eventual aquisição desse material poderá ser negociada posteriormente entre as partes, mediante acordo específico sobre condições e valores. Caso o material ainda não tenha sido editado, ele poderá ser enviado ao cliente em arquivo bruto, conforme ajustado entre as partes.",
    "O material já postado pode ser solicitado para uso pessoal ou comercial pelo cliente dentro do prazo do contrato; após isso, deve ser observada a cláusula 13.",
    "A produtora se compromete a não criar, desenvolver ou utilizar fotos ou vídeos que distorçam a realidade do produto apresentado. A finalidade desse compromisso é eliminar a necessidade do uso da expressão imagem meramente ilustrativa.",
    "O cliente deve fornecer os materiais indispensáveis ao serviço e aprovar os posts, quando entregues, em tempo hábil. Se o processo de captação e produção for atrasado por falta de suporte do cliente, a produtora fica isenta da responsabilidade de entrega nos prazos do plano, sem prejuízo do valor da mensalidade.",
    "O contratante tem a responsabilidade de designar uma pessoa autorizada para aprovar os materiais produzidos, garantindo uma avaliação eficiente e sem comprometer o processo de entrega.",
    "É liberado o uso do material captado e produzido como portfólio da produtora, respeitando sempre a integridade da marca.",
  ] },
  { title: "Observações contratuais (continuação)", items: [
    "Qualquer captação que não se enquadre nos itens da cobertura do plano é serviço não incluso e deverá ter valor acordado entre as partes.",
    "É dado ao cliente o direito de solicitar 1 reunião por mês, exclusivamente online, com duração de até 30 (trinta) minutos, sujeita à disponibilidade da produtora.",
    "Prestamos serviço para a empresa na cidade onde ela está localizada. Externas em outras cidades deverão ter disponibilidade consultada pela produtora e o translado será pago pelo cliente.",
    "A realização de uma captação adicional está sujeita à disponibilidade da produtora e ao pagamento de uma taxa de externa adicional equivalente a 50% do valor do plano.",
    "A produtora, ora contratada, não possui obrigatoriedade de se fazer presente nas instalações do contratante ou em qualquer espaço deste de forma mensal, comprometendo-se a estar disponível no dia e hora previamente marcados para realização da produção.",
    "Após o fim dos serviços contratados, será enviado um link de acesso ao material utilizado e postado nas redes sociais, que ficará disponível por 7 (sete) dias corridos a partir do envio pelo grupo de WhatsApp. Após esse prazo, sem aviso, o link estará indisponível e a contratada não terá responsabilidade de reenvio ou guarda desse material.",
    "A Lei Geral de Proteção de Dados, conhecida como LGPD, será respeitada em todos os seus termos pela contratada e pela contratante, obrigando as partes a tratarem os dados eventualmente coletados conforme sua necessidade ou obrigatoriedade.",
  ] },
];
const deliveryDeadlines = [
  ["Banner", "3 dias úteis"],
  ["Material captado em cobertura fotográfica", "7 dias úteis"],
  ["Alteração do banner", "1 dia útil"],
  ["Material de design off", "10 dias úteis"],
  ["Vídeo", "7 dias úteis"],
  ["Alteração do vídeo", "3 dias úteis (até 1 alteração por vídeo)"],
] as const;
const listValue = <T extends object>(value: unknown): T[] => Array.isArray(value)
  ? value.filter((item): item is T => Boolean(item && typeof item === "object"))
  : [];
async function readJson(response: Response): Promise<JsonObject> {
  const value = await response.json().catch(() => null);
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "sagitarioBrand sagitarioBrandCompact" : "sagitarioBrand"} aria-label="Sagitário"><Image src="/sagitario-full-logo.png" alt="" width={1994} height={789} priority /></div>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={wide ? "field fieldWide" : "field"}><span>{label}</span>{children}</label>;
}

function ContractPage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`contractPage ${className}`}><Image className="contractLetterhead" src="/frame-letterhead.svg" alt="" width={596} height={843} unoptimized loading="eager" /><div className="contractPageContent">{children}</div></section>;
}

function ContractMasthead({ title }: { title: string }) {
  return <header className="contractMasthead"><div><strong>@framerec</strong><span>www.framerec.com.br</span></div><div><span>contato@framerec.com.br</span><span>(79) 99890-6462</span></div><div className="contractMark" aria-hidden="true">FR</div><h2>{title}</h2></header>;
}

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [nicheId, setNicheId] = useState("");
  const [selection, setSelection] = useState<Selection>({});
  const [search, setSearch] = useState("");
  const [conditions, setConditions] = useState<Conditions>(initialConditions);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [mobileSummaryOpen, setMobileSummaryOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    fetch("/api/catalog", { cache:"no-store" }).then(async (response) => {
      const payload = await readJson(response);
      if (!response.ok) {
        const message = typeof payload.message === "string" && payload.message.trim() ? payload.message : "Não foi possível carregar os dados.";
        throw new Error(message);
      }
      const niches = listValue<Niche>(payload.niches).filter((item) => typeof item.id === "string" && typeof item.name === "string");
      const services = listValue<Service>(payload.services).map((item) => ({
        ...item,
        nicheIds: Array.isArray(item.nicheIds) ? item.nicheIds.map(String) : [],
      })).filter((item) => typeof item.id === "string" && typeof item.name === "string" && item.nicheIds.length);
      const company = payload.company && typeof payload.company === "object" && !Array.isArray(payload.company) ? payload.company as Company : null;
      return { niches, services, company } satisfies Catalog;
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
  const nicheServices = useMemo(() => (catalog?.services || []).filter((service) => service.nicheIds.includes(nicheId)), [catalog, nicheId]);
  const selectedServices = useMemo(() => Object.entries(selection).map(([id, quantity]) => ({ service:servicesById.get(id), quantity })).filter((item): item is { service:Service; quantity:number } => Boolean(item.service)), [selection, servicesById]);
  const setupTotal = useMemo(() => selectedServices.reduce((sum, { service, quantity }) => service.billingType === "setup" ? sum + service.price * quantity : sum, 0), [selectedServices]);
  const serviceReferenceTotal = useMemo(() => selectedServices.reduce((sum, { service, quantity }) => service.billingType === "setup" ? sum : sum + service.price * quantity, 0), [selectedServices]);
  const monthlyPlanTotal = serviceReferenceTotal * MONTHLY_PLAN_RATE;

  const filteredServices = useMemo(() => nicheServices.filter((service) => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    const matchesSearch = !query || `${service.name} ${service.description} ${service.unit}`.toLocaleLowerCase("pt-BR").includes(query);
    return matchesSearch;
  }), [nicheServices, search]);

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
    const compatible = new Set((catalog?.services || []).filter((service) => service.nicheIds.includes(nextNicheId)).map((service) => service.id));
    const incompatible = Object.keys(selection).filter((id) => !compatible.has(id));
    if (incompatible.length && !window.confirm("A mudança de nicho removerá serviços incompatíveis da seleção. Deseja continuar?")) return;
    setSelection((current) => Object.fromEntries(Object.entries(current).filter(([id]) => compatible.has(id))));
    setNicheId(nextNicheId); setValidationMessage("");
  };
  const clearSelection = () => {
    if (selectedServices.length && !window.confirm("Limpar todos os serviços e condições desta proposta?")) return;
    setSelection({}); setConditions(initialConditions); setSearch(""); setValidationMessage("");
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
    <main className="appShell" data-ui="saas-v4">
      <header className="topbar"><div className="brandCluster"><Brand /><span className="brandDescriptor">Propostas comerciais</span></div><div className="headerActions"><div className="selectionStatus" aria-live="polite"><span>Selecionados</span><strong>{selectedServices.length}</strong></div><a id="sagitario-admin-v4" className="adminButton desktopAdminLink" href={ADMIN_URL} target="_self" aria-label="Abrir administração do Sagitário"><span aria-hidden="true">⚙</span> Admin</a><button className="secondaryButton" onClick={clearSelection}>Limpar seleção</button></div></header>
      <section className="welcomePanel" aria-labelledby="welcome-title"><div className="welcomeCopy"><span className="welcomeEyebrow">SAGITÁRIO · PROPOSTA RÁPIDA</span><h1 id="welcome-title">Escolha os serviços<br className="desktopOnly" /> para começar.</h1><p>Marque os itens que você precisa e acompanhe o valor da proposta em tempo real.</p></div><div className="welcomeMeta" aria-label="Etapas da proposta"><div><strong>01</strong><span>Nicho</span></div><div><strong>02</strong><span>Serviços</span></div><div><strong>03</strong><span>Revisão</span></div></div></section>
      {validationMessage && <div className="validationBanner" role="alert">{validationMessage}</div>}
      <section className="nicheSection" aria-labelledby="niche-title"><div><span className="stepNumber">01</span><div><h2 id="niche-title">Escolha o nicho</h2><p>Os serviços disponíveis se adaptam à escolha.</p></div></div><div className="nicheButtons" role="group" aria-label="Nichos">{catalog.niches.map((niche) => <button key={niche.id} onClick={() => changeNiche(niche.id)} className={niche.id === nicheId ? "active" : ""}>{niche.name}</button>)}</div></section>
      <nav className="mobileQuickNav" aria-label="Atalhos da proposta"><a href="#services">Serviços <b>{selectedServices.length}</b></a><a href="#comparison">Comparar</a><a id="sagitario-admin-mobile-v4" className="adminQuickLink" href={ADMIN_URL} target="_self" aria-label="Abrir administração do Sagitário">⚙ Admin</a></nav>
      <div className="workspaceGrid">
        <div className="mainColumn">
          <section className="sectionBlock servicesSection" id="services" aria-labelledby="services-title">
            <div className="sectionTitle"><span className="stepNumber">02</span><div><h2 id="services-title">Marque os serviços</h2><p>Toque em uma linha para incluir e ajuste a quantidade quando precisar.</p></div></div>
            <div className="filtersBar"><label className="searchField"><span className="srOnly">Pesquisar serviços</span><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar serviço" /></label></div>
            {filteredServices.length ? <div className="serviceGroup"><h3>{currentNiche?.name || "Serviços disponíveis"}<span>{filteredServices.length}</span></h3><div className="serviceList">{filteredServices.map((service) => {
              const checked = selection[service.id] !== undefined; const quantity = selection[service.id] ?? service.defaultQuantity;
              return <article key={service.id} className={checked ? "serviceRow selected" : "serviceRow"}><label className="checkWrap"><input type="checkbox" checked={checked} onChange={() => toggleService(service)} /><span className="customCheck" /></label><div className="serviceInfo" role="button" tabIndex={0} aria-pressed={checked} onClick={() => toggleService(service)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleService(service); } }}><div className="serviceNameLine"><h4>{service.name}</h4>{service.billingType === "setup" && <span className="billingTag setup">Taxa inicial</span>}</div>{service.description && <p>{service.description}</p>}<small>{formatMoney(service.price)} por {service.unit}</small></div><div className="quantityControl" aria-label={`Quantidade de ${service.name}`}><button disabled={!checked || quantity <= service.minQuantity} onClick={() => changeQuantity(service,-1)} aria-label="Diminuir quantidade">−</button><output>{quantity}</output><button disabled={!checked || (service.maxQuantity !== null && quantity >= service.maxQuantity)} onClick={() => changeQuantity(service,1)} aria-label="Aumentar quantidade">+</button></div></article>;
            })}</div></div> : <div className="emptyState"><strong>Nenhum serviço encontrado.</strong><span>Ajuste a pesquisa ou confira o cadastro deste nicho.</span></div>}
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
            <div className="conditionsBody"><div className="fieldsGrid proposalFields"><Field label="Nome da empresa / sócio"><input value={conditions.client} onChange={(e) => setCondition("client",e.target.value)} placeholder="Ex.: Empresa ou João Silva" /></Field><Field label="CNPJ / CPF"><input value={conditions.document} onChange={(e) => setCondition("document",e.target.value)} placeholder="00.000.000/0000-00" inputMode="numeric" /></Field><Field label="Data de vencimento"><input type="date" value={conditions.dueDay} onChange={(e) => setCondition("dueDay",e.target.value)} /></Field></div></div>
          </details>
        </div>
        <aside className="summaryPanel">{renderSummary()}</aside>
      </div>
    </main>

    <div className="mobileBottomBar"><div><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div><button onClick={() => setMobileSummaryOpen(true)}>Ver resumo{selectedServices.length ? ` · ${selectedServices.length}` : ""}</button></div>
    {mobileSummaryOpen && <div className="overlay mobileSummaryOverlay" onMouseDown={(e) => e.target === e.currentTarget && setMobileSummaryOpen(false)}><aside className="mobileSummary">{renderSummary(true)}</aside></div>}
    {reviewOpen && <div className="overlay reviewOverlay" role="dialog" aria-modal="true" aria-labelledby="review-title" onMouseDown={(e) => e.target === e.currentTarget && setReviewOpen(false)}><div className="reviewModal screenOnly"><div className="reviewHeader"><div><span className="eyebrow red">Revisão final</span><h2 id="review-title">Confira antes de gerar o PDF</h2></div><button className="iconButton" onClick={() => setReviewOpen(false)} aria-label="Fechar revisão">×</button></div><div className="reviewBody"><div className="reviewMeta"><div><span>Nicho</span><strong>{currentNiche?.name || "—"}</strong></div>{conditions.client && <div><span>Proposta para</span><strong>{conditions.client}</strong></div>}{conditions.document && <div><span>CNPJ / CPF</span><strong>{conditions.document}</strong></div>}{conditions.dueDay && <div><span>Vencimento</span><strong>{formatDate(conditions.dueDay)}</strong></div>}</div><div className="reviewTable"><div className="reviewTableHead"><span>Serviço</span><span>Qtd.</span><span>Subtotal</span></div>{selectedServices.map(({ service,quantity }) => <div className="reviewTableRow" key={service.id}><span>{service.name}</span><span>{quantity}</span><strong>{formatMoney(service.price * quantity)}</strong></div>)}</div><div className="reviewTotals"><div className="reviewFullValue"><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></div><div><span>Condição especial de recorrência</span><strong>{formatMoney(monthlyPlanTotal)}/mês</strong></div>{setupTotal > 0 && <div><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></div>}</div></div><div className="reviewActions"><button className="secondaryButton" onClick={() => setReviewOpen(false)}>Voltar e corrigir</button><button className="primaryButton" onClick={() => window.print()}>Baixar / imprimir em PDF</button></div></div></div>}

    <article className="printProposal"><header className="printHeader"><Brand compact /><div><span>PROPOSTA COMERCIAL</span><h1>{conditions.client || "Proposta de serviços"}</h1><p>{currentNiche?.name || ""}</p></div></header>{(conditions.client || conditions.document) && <section className="printIdentification"><h2>Identificação</h2><div>{conditions.client && <p><span>Nome da empresa / sócio</span><strong>{conditions.client}</strong></p>}{conditions.document && <p><span>CNPJ / CPF</span><strong>{conditions.document}</strong></p>}</div></section>}<section><h2>Serviços selecionados</h2><table><thead><tr><th>Serviço</th><th>Qtd.</th><th>Unidade</th><th>Unitário</th><th>Subtotal</th></tr></thead><tbody>{selectedServices.map(({ service,quantity }) => <tr key={service.id}><td>{service.name}</td><td>{quantity}</td><td>{service.unit}</td><td>{formatMoney(service.price)}</td><td>{formatMoney(service.price * quantity)}</td></tr>)}</tbody></table><div className="printTotals"><p className="printFullValue"><span>Valor do plano</span><strong>{formatMoney(serviceReferenceTotal)}</strong></p><p><span>Condição especial de recorrência</span><strong>{formatMoney(monthlyPlanTotal)}</strong></p>{setupTotal > 0 && <p><span>Taxa inicial</span><strong>{formatMoney(setupTotal)}</strong></p>}</div></section>{serviceReferenceTotal > 0 && <section><h2>Condição especial de recorrência</h2><div className="printPlan"><div><span>Valor mensal</span><strong>{formatMoney(monthlyPlanTotal)}/mês</strong></div>{setupTotal > 0 && <div><span>Taxa inicial à parte</span><strong>{formatMoney(setupTotal)}</strong></div>}</div></section>}<section><h2>Vencimento</h2><div className="printConditions"><p><span>Data de vencimento</span><strong>{formatDate(conditions.dueDay)}</strong></p></div></section><ContractPage className="contractIntro"><ContractMasthead title="TERMOS DE CONTRATO" /><div className="contractClient"><span>Contratante</span><strong>{conditions.client || "A preencher"}</strong>{conditions.document && <small>CNPJ / CPF: {conditions.document}</small>}{conditions.dueDay && <small>Data de vencimento: {formatDate(conditions.dueDay)}</small>}</div><h3>Proposta Comercial - Produtora Frame</h3>{contractSections[0].paragraphs?.map((text, index) => <p key={index}>{text}</p>)}</ContractPage><ContractPage><ContractMasthead title="TERMOS DE CONTRATO" /><h3>{contractSections[1].title}</h3><ol>{contractSections[1].items?.map((text, index) => <li key={index}>{text}</li>)}</ol></ContractPage><ContractPage><ContractMasthead title="TERMOS DE CONTRATO" /><h3>{contractSections[2].title}</h3><ol start={8}>{contractSections[2].items?.map((text, index) => <li key={index}>{text}</li>)}</ol></ContractPage><ContractPage className="contractClosing"><ContractMasthead title="PRAZOS E ENCERRAMENTO" /><h3>Prazos de entrega</h3><p className="contractLead">Referentes a demandas fora do planner mensal.</p><div className="deadlineTable">{deliveryDeadlines.map(([name, deadline]) => <div key={name}><span>{name}</span><strong>{deadline}</strong></div>)}</div><div className="contractThanks"><strong>Obrigado!</strong><p>Acompanhe-nos em nossos canais de contato. Mesmo em movimento, estamos sempre prontos para o trabalho.</p></div><div className="contractContacts"><span>www.framerec.com.br</span><span>(79) 99890-6462</span><span>contato@framerec.com.br</span></div></ContractPage><footer>Sagitário · Frame Rec{catalog.company?.email ? ` · ${catalog.company.email}` : ""}{catalog.company?.phone ? ` · ${catalog.company.phone}` : ""}</footer></article>
  </>;
}
