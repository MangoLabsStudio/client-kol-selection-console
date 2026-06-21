import { AnimatePresence, motion } from "framer-motion";
import { Download, FileJson, Inbox, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DecisionModal } from "./components/DecisionModal";
import { FilterBar } from "./components/FilterBar";
import { HistoryDrawer } from "./components/HistoryDrawer";
import { LearningBoard } from "./components/LearningBoard";
import { ReviewPoolCard } from "./components/ReviewPoolCard";
import { RootAudienceBoard } from "./components/RootAudienceBoard";
import { RuleBoard } from "./components/RuleBoard";
import { SkeletonBoard } from "./components/SkeletonBoard";
import { StrategyMethodBoard } from "./components/StrategyMethodBoard";
import { ToastStack, type Toast } from "./components/ToastStack";
import { exportBoard, getAppConfig, getBoardForCampaign, getHistory, lockBoard, submitDecision } from "./lib/api";
import type { ActorRole, AppConfig, BoardResponse, CampaignKolItem, Filters, SelectionEvent, SelectionStatus, Summary } from "./lib/types";
import { useDebouncedValue } from "./lib/useDebouncedValue";

const initialFilters: Filters = {
  status: "all",
  platform: "all",
  category: "all",
  language: "all",
  region: "all",
  followers: "all",
  contactStatus: "all",
  riskTag: "all",
  query: ""
};

type LoadingTarget = {
  itemId: string;
  status: SelectionStatus | "undo";
} | null;

export default function App() {
  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => getInitialProjectId());
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [actorRole, setActorRole] = useState<ActorRole>("client");
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [loadingTarget, setLoadingTarget] = useState<LoadingTarget>(null);
  const [modal, setModal] = useState<{ kind: "reject" | "question"; item: CampaignKolItem } | null>(null);
  const [historyItem, setHistoryItem] = useState<CampaignKolItem | null>(null);
  const [historyEvents, setHistoryEvents] = useState<SelectionEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [exporting, setExporting] = useState(false);
  const [locking, setLocking] = useState(false);
  const debouncedQuery = useDebouncedValue(filters.query);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setBoard(null);

    getAppConfig(activeProjectId)
      .then(async (config) => {
        if (!active) return null;
        setAppConfig(config);
        return getBoardForCampaign(config.campaignId, actorRole);
      })
      .then((data) => {
        if (active && data) setBoard(data);
      })
      .catch((error) => pushToast("danger", error.message))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeProjectId, actorRole]);

  const filteredItems = useMemo(() => {
    if (!board) return [];
    const query = debouncedQuery.trim().toLowerCase();

    return board.items.filter((item) => {
      const status = item.currentState.currentStatus;
      if (filters.status !== "all" && status !== filters.status) return false;
      if (filters.platform !== "all" && item.kol.platform !== filters.platform) return false;
      if (filters.category !== "all" && item.kol.contentCategory !== filters.category) return false;
      if (filters.language !== "all" && item.kol.language !== filters.language) return false;
      if (filters.region !== "all" && item.kol.region !== filters.region) return false;
      if (filters.contactStatus !== "all" && item.contactStatus !== filters.contactStatus) return false;
      if (filters.riskTag !== "all" && !item.riskTags.includes(filters.riskTag)) return false;
      if (!matchesFollowerRange(item.kol.followers, filters.followers)) return false;
      if (!query) return true;

      const haystack = [
        item.kol.name,
        item.kol.handle,
        item.kol.platform,
        item.kol.contentCategory,
        item.kol.audienceSummary,
        item.recommendedAngle,
        item.whyIncluded,
        item.clientFacingNote,
        item.riskTags.join(" ")
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [board, debouncedQuery, filters]);

  if (loading && (!board || !appConfig)) return <SkeletonBoard />;

  if (!board || !appConfig) {
    return (
      <main className="error-state">
        <Inbox size={34} />
        <h1>评审页面暂不可用</h1>
        <p>当前无法加载候选名单，请刷新后重试。</p>
        <button type="button" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          重新加载
        </button>
      </main>
    );
  }

  const ui = appConfig.ui;
  const heroMetrics =
    ui.hero.metrics ?? [
      { value: String(board.summary.total), label: ui.hero.metricLabels.total },
      { value: String(board.summary.approved), label: ui.hero.metricLabels.approved },
      { value: String(board.summary.rejected), label: ui.hero.metricLabels.rejected },
      { value: String(board.summary.question), label: ui.hero.metricLabels.question }
    ];

  const decide = async (item: CampaignKolItem, toStatus: SelectionStatus, reasonTags: string[] = [], note = "", loadingStatus: SelectionStatus | "undo" = toStatus) => {
    const previous = board;
    const optimisticBoard = applyLocalState(board, item.id, toStatus, reasonTags, note, actorRole);
    setBoard(optimisticBoard);
    setLoadingTarget({ itemId: item.id, status: loadingStatus });

    try {
      const result = await submitDecision({
        campaignId: board.campaign.id,
        itemId: item.id,
        actorRole,
        toStatus,
        reasonTags,
        note
      });
      setBoard((current) => {
        if (!current) return current;
        return {
          ...current,
          summary: result.summary,
          campaign: { ...current.campaign, lastUpdatedAt: result.currentState.lastUpdatedAt },
          items: current.items.map((candidate) => (candidate.id === item.id ? { ...candidate, currentState: result.currentState } : candidate))
        };
      });
      setModal(null);
      pushToast("success", toastMessage(toStatus));
    } catch (error) {
      setBoard(previous);
      pushToast("danger", error instanceof Error ? error.message : "保存失败，请稍后重试。");
    } finally {
      setLoadingTarget(null);
    }
  };

  const openHistory = (item: CampaignKolItem) => {
    setHistoryItem(item);
    setHistoryEvents([]);
    setHistoryLoading(true);
    getHistory(board.campaign.id, item.id)
      .then(({ events }) => setHistoryEvents(events))
      .catch((error) => pushToast("danger", error.message))
      .finally(() => setHistoryLoading(false));
  };

  const handleExport = async (format: "json" | "csv") => {
    setExporting(true);
    try {
      await exportBoard(board.campaign.id, appConfig.projectId, format);
      pushToast("success", `已导出 ${format.toUpperCase()} 文件。`);
    } catch (error) {
      pushToast("danger", error instanceof Error ? error.message : "导出失败，请稍后重试。");
    } finally {
      setExporting(false);
    }
  };

  const handleLock = async () => {
    setLocking(true);
    try {
      const nextBoard = await lockBoard(board.campaign.id, actorRole);
      setBoard(nextBoard);
      pushToast("success", "评审版本已锁定。");
    } catch (error) {
      pushToast("danger", error instanceof Error ? error.message : "锁定失败，请稍后重试。");
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="client-shell">
      <aside className="side">
        <div className="brand">
          <div className="brand-mark">{ui.brand.mark}</div>
          <div>
            <h1>{ui.brand.name}</h1>
            <p>{ui.brand.subtitle}</p>
          </div>
        </div>
        {appConfig.availableProjects.length > 1 && (
          <label className="project-picker">
            <span>项目</span>
            <select value={appConfig.projectId} onChange={(event) => changeProject(event.target.value)}>
              {appConfig.availableProjects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.clientName} · {project.campaignName}
                </option>
              ))}
            </select>
          </label>
        )}
        <nav className="nav" aria-label="页面导航">
          {ui.navigation.map((item) => (
            <a href={item.target} key={item.target}>
              {item.label} <span>{item.index}</span>
            </a>
          ))}
        </nav>
        <div className="side-note">{ui.sideNote}</div>
      </aside>

      <main className="main">
        <section className="hero section" id="top">
          <div className="constellation" aria-hidden="true">
            <svg viewBox="0 0 1200 700" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lineGradient" x1="0" x2="1">
                  <stop stopColor="#6ab7ab" stopOpacity="0.18" />
                  <stop offset="1" stopColor="#d9c478" stopOpacity="0.34" />
                </linearGradient>
              </defs>
              <g fill="none" stroke="url(#lineGradient)" strokeWidth="1.2">
                <path d="M725 104 C820 160 815 254 920 318 S1050 456 1120 570" />
                <path d="M648 210 C758 244 812 332 914 372" />
                <path d="M734 522 C813 418 895 426 1010 376" />
                <path d="M690 372 C772 354 812 296 886 232" />
              </g>
              <g fill="#f7faf8" fillOpacity="0.72">
                <circle cx="724" cy="104" r="5" />
                <circle cx="648" cy="210" r="4" />
                <circle cx="690" cy="372" r="6" />
                <circle cx="734" cy="522" r="4" />
                <circle cx="886" cy="232" r="5" />
                <circle cx="914" cy="372" r="4" />
                <circle cx="1010" cy="376" r="6" />
              </g>
            </svg>
          </div>
          <div className="section-inner hero-inner">
            <span className="eyebrow">{ui.hero.eyebrow}</span>
            <h2>{ui.hero.title}</h2>
            <p className="hero-lede">{ui.hero.lede}</p>
            <div className="hero-grid" aria-label="评审数据">
              {heroMetrics.map((metric) => (
                <div className="metric" key={metric.label}>
                  <strong>{metric.value}</strong>
                  <span>{metric.label}</span>
                </div>
              ))}
            </div>
            <div className="hero-actions" id="export">
              <div className="role-switch dark">
                <button className={actorRole === "client" ? "active" : ""} onClick={() => setActorRole("client")} type="button">
                  客户视图
                </button>
                <button className={actorRole === "agency" ? "active" : ""} onClick={() => setActorRole("agency")} type="button">
                  团队视图
                </button>
              </div>
              <button className="hero-action" type="button" onClick={() => handleExport("json")} disabled={exporting}>
                <FileJson size={17} />
                JSON
              </button>
              <button className="hero-action" type="button" onClick={() => handleExport("csv")} disabled={exporting}>
                <Download size={17} />
                CSV
              </button>
              {actorRole !== "client" && (
                <button className="hero-action lock" type="button" onClick={handleLock} disabled={locking || Boolean(board.campaign.lockedAt)}>
                  <LockKeyhole size={17} />
                  {board.campaign.lockedAt ? "已锁定" : "锁定版本"}
                </button>
              )}
            </div>
          </div>
        </section>

        <LearningBoard
          summary={board.summary}
          config={ui.learning}
          onExportLearning={() => {
            pushToast("info", "规则 JSON 已显示在面板下方。");
          }}
        />

        {ui.roots && <RootAudienceBoard config={ui.roots} />}

        <StrategyMethodBoard method={ui.method} />

        <section className="section" id="pool">
          <div className="section-inner">
            <div className="section-title">
              <span className="eyebrow">{ui.pool.eyebrow}</span>
              <h2>{ui.pool.title}</h2>
              <p>{ui.pool.description}</p>
            </div>

            <FilterBar items={board.items} filters={filters} resultCount={filteredItems.length} onChange={setFilters} />

            <div className="pool-browser" aria-label="KOL 执行池">
              <div className="pool-browser-head">
                <div>
                  <strong>{filteredItems.length}</strong>
                  <span>{filteredItems.length === board.items.length ? ui.pool.allCandidatesLabel : `共 ${board.items.length} 项`}</span>
                </div>
                <div className="pool-status-note">
                  <ShieldCheck size={17} />
                  {board.summary.pending === 0 ? ui.pool.reviewedLabel : `${board.summary.pending} ${ui.pool.pendingDecisionLabel}`}
                </div>
              </div>

              {filteredItems.length === 0 ? (
                <motion.section className="empty-state" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <Inbox size={34} />
                  <h2>{ui.pool.emptyTitle}</h2>
                  <button type="button" onClick={() => setFilters(initialFilters)}>
                    {ui.pool.emptyAction}
                  </button>
                </motion.section>
              ) : (
                <motion.section className="expanded-pool-grid" layout aria-label="候选账号卡片">
                  <AnimatePresence mode="popLayout">
                    {filteredItems.map((item) => (
                      <ReviewPoolCard
                        key={item.id}
                        item={item}
                        loadingStatus={loadingTarget?.itemId === item.id ? loadingTarget.status : null}
                        onApprove={(candidate) => decide(candidate, "approved")}
                        onReject={(candidate) => setModal({ kind: "reject", item: candidate })}
                        onQuestion={(candidate) => setModal({ kind: "question", item: candidate })}
                        onUndo={(candidate) => decide(candidate, "pending", [], "已撤回至待评审状态。", "undo")}
                        onHistory={openHistory}
                      />
                    ))}
                  </AnimatePresence>
                </motion.section>
              )}
            </div>

            <RuleBoard config={ui.rules} />
          </div>
        </section>

        <StrategyMethodBoard signalLogic={ui.signalLogic} dataNote={ui.dataNote} />

      <DecisionModal
        kind={modal?.kind ?? "reject"}
        item={modal?.item ?? null}
        submitting={Boolean(loadingTarget)}
        onClose={() => setModal(null)}
        onSubmit={({ toStatus, reasonTags, note }) => modal && decide(modal.item, toStatus, reasonTags, note)}
      />

      <HistoryDrawer item={historyItem} events={historyEvents} loading={historyLoading} onClose={() => setHistoryItem(null)} />
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
      </main>
    </div>
  );

  function pushToast(tone: Toast["tone"], message: string) {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }

  function changeProject(projectId: string) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("project", projectId);
    window.history.replaceState({}, "", nextUrl);
    setFilters(initialFilters);
    setActiveProjectId(projectId);
  }
}

function getInitialProjectId() {
  return new URLSearchParams(window.location.search).get("project");
}

function applyLocalState(board: BoardResponse, itemId: string, status: SelectionStatus, reasonTags: string[], note: string, actorRole: ActorRole): BoardResponse {
  const timestamp = new Date().toISOString();
  const items = board.items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          currentState: {
            ...item.currentState,
            currentStatus: status,
            currentDecision: status,
            currentReasonTags: reasonTags,
            currentNote: note,
            lastActorId: actorRole === "agency" ? "agency-ops" : "client-reviewer-1",
            lastActorRole: actorRole,
            lastUpdatedAt: timestamp
          }
        }
      : item
  );

  return {
    ...board,
    campaign: { ...board.campaign, lastUpdatedAt: timestamp },
    summary: summarize(items),
    items
  };
}

function summarize(items: CampaignKolItem[]): Summary {
  const summary: Summary = {
    total: items.length,
    pending: 0,
    approved: 0,
    rejected: 0,
    question: 0,
    hold: 0
  };
  items.forEach((item) => {
    summary[item.currentState.currentStatus] += 1;
  });
  return summary;
}

function matchesFollowerRange(followers: number, range: string) {
  if (range === "all") return true;
  if (range === "<100k") return followers < 100000;
  if (range === "100k-250k") return followers >= 100000 && followers < 250000;
  if (range === "250k-750k") return followers >= 250000 && followers < 750000;
  if (range === "750k+") return followers >= 750000;
  return true;
}

function toastMessage(status: SelectionStatus) {
  if (status === "approved") return "已记录为通过。";
  if (status === "rejected") return "已记录排除原因。";
  if (status === "question") return "补充请求已记录。";
  return "已撤回至待评审。";
}
