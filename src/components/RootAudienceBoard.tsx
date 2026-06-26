import { CheckCircle2, CircleHelp, ExternalLink, LockKeyhole, MessageSquareText, RotateCcw, Sparkles, Trash2, Undo2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createRootAudienceGeneration, submitClientAction } from "../lib/api";
import type { KolGenerationRun, RootAudienceConfig, RootAudienceSnapshotInput, RootPersonConfig } from "../lib/types";

type RootStatus = "pending" | "approved" | "rejected" | "question";

type RootDecision = {
  status: RootStatus;
  reason?: string;
  note?: string;
  updatedAt: string;
};

type RootMemory = {
  id: string;
  round: number;
  createdAt: string;
  decisions: Record<string, RootDecision>;
};

type RootAudienceState = {
  round: number;
  decisions: Record<string, RootDecision>;
  ruleComments: Record<string, string>;
  memory: RootMemory[];
};

type RootAudienceBoardProps = {
  campaignId: string;
  config: RootAudienceConfig;
  generating?: boolean;
  onGenerated?: (run: KolGenerationRun) => void;
  onActionError?: (message: string) => void;
  onGenerateControlChange?: (
    control: {
      run: () => void;
      disabled: boolean;
      label: string;
      approved: number;
    } | null
  ) => void;
};

const rejectReasons = ["目标层级不匹配", "议题关联不足", "本轮不优先", "需要换一批"];

export function RootAudienceBoard({ campaignId, config, generating = false, onGenerated, onActionError, onGenerateControlChange }: RootAudienceBoardProps) {
  const [state, setState] = useState<RootAudienceState>(() => readState(config.storageKey));
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const [submittingGeneration, setSubmittingGeneration] = useState(false);
  const isGenerating = generating || submittingGeneration;

  useEffect(() => {
    localStorage.setItem(config.storageKey, JSON.stringify(state));
  }, [config.storageKey, state]);

  const stats = useMemo(() => summarizeRootDecisions(config, state.decisions), [config, state.decisions]);
  const rootLookup = useMemo(() => {
    const lookup = new Map<string, { person: RootPersonConfig; groupName: string }>();
    config.groups.forEach((group) => {
      group.people.forEach((person) => lookup.set(person.handle, { person, groupName: group.name }));
    });
    return lookup;
  }, [config]);

  const recordAction = (input: {
    entityType: string;
    entityId: string;
    actionType: string;
    fromValue?: string | null;
    toValue?: string | null;
    reasonTags?: string[];
    note?: string;
    metadata?: Record<string, unknown>;
  }) => {
    void submitClientAction({
      campaignId,
      actorRole: "client",
      surface: "root_audience",
      ...input
    }).catch((error) => {
      console.warn("Root audience action log failed", error);
      onActionError?.("目标人群点击记录保存失败，请刷新后再试。");
    });
  };

  useEffect(() => {
    const syncKey = `${config.storageKey}:server-sync:${campaignId}:v1`;
    if (localStorage.getItem(syncKey)) return;

    const decisions = Object.entries(state.decisions);
    const comments = Object.entries(state.ruleComments).filter(([, comment]) => comment.trim().length > 0);
    if (decisions.length === 0 && comments.length === 0) {
      localStorage.setItem(syncKey, new Date().toISOString());
      return;
    }

    decisions.forEach(([handle, decision]) => {
      const root = rootLookup.get(handle);
      recordAction({
        entityType: "root_person",
        entityId: handle,
        actionType: "local_decision_sync",
        fromValue: "localStorage",
        toValue: decision.status,
        reasonTags: decision.reason ? [decision.reason] : [],
        note: decision.note ?? "",
        metadata: {
          source: "localStorage_recovery",
          originalUpdatedAt: decision.updatedAt,
          personName: root?.person.name ?? handle,
          personRole: root?.person.role ?? "",
          groupName: root?.groupName ?? "",
          round: state.round,
          memoryRounds: state.memory.length
        }
      });
    });

    comments.forEach(([groupName, comment]) => {
      recordAction({
        entityType: "root_group",
        entityId: groupName,
        actionType: "local_rule_comment_sync",
        fromValue: "localStorage",
        toValue: "server",
        note: comment,
        metadata: {
          source: "localStorage_recovery",
          groupName,
          round: state.round,
          memoryRounds: state.memory.length
        }
      });
    });

    localStorage.setItem(syncKey, new Date().toISOString());
  }, [campaignId, config.storageKey, rootLookup, state.decisions, state.memory.length, state.round, state.ruleComments]);

  const decide = (person: RootPersonConfig, status: RootStatus, reason?: string, groupName?: string) => {
    const previous = state.decisions[person.handle];
    setState((current) => {
      const previous = current.decisions[person.handle];
      const timestamp = new Date().toISOString();
      const nextDecision: RootDecision = {
        status,
        reason,
        note: status === "question" ? previous?.note ?? "" : undefined,
        updatedAt: timestamp
      };

      return {
        ...current,
        decisions: {
          ...current.decisions,
          [person.handle]: nextDecision
        }
      };
    });

    recordAction({
      entityType: "root_person",
      entityId: person.handle,
      actionType: previous?.status === status && status === "rejected" ? "reject_reason_selected" : "decision_set",
      fromValue: previous?.status ?? "pending",
      toValue: status,
      reasonTags: reason ? [reason] : [],
      note: status === "question" ? previous?.note ?? "" : "",
      metadata: {
        personName: person.name,
        personRole: person.role,
        groupName,
        round: state.round,
        previousReason: previous?.reason ?? null
      }
    });
  };

  const undoDecision = (person: RootPersonConfig, groupName?: string) => {
    const previous = state.decisions[person.handle];
    setState((current) => {
      const previous = current.decisions[person.handle];
      if (!previous) return current;

      const nextDecisions = { ...current.decisions };
      delete nextDecisions[person.handle];

      return {
        ...current,
        decisions: nextDecisions
      };
    });

    if (previous) {
      recordAction({
        entityType: "root_person",
        entityId: person.handle,
        actionType: "decision_undo",
        fromValue: previous.status,
        toValue: "pending",
        reasonTags: previous.reason ? [previous.reason] : [],
        note: previous.note ?? "",
        metadata: {
          personName: person.name,
          personRole: person.role,
          groupName,
          round: state.round
        }
      });
    }
  };

  const setNote = (person: RootPersonConfig, note: string) => {
    setState((current) => ({
      ...current,
      decisions: {
        ...current.decisions,
        [person.handle]: {
          ...current.decisions[person.handle],
          status: current.decisions[person.handle]?.status ?? "question",
          note,
          updatedAt: new Date().toISOString()
        }
      }
    }));
  };

  const commitNote = (person: RootPersonConfig, note: string, groupName?: string) => {
    recordAction({
      entityType: "root_person",
      entityId: person.handle,
      actionType: "question_note_updated",
      fromValue: state.decisions[person.handle]?.note ?? "",
      toValue: note,
      note,
      metadata: {
        personName: person.name,
        personRole: person.role,
        groupName,
        round: state.round
      }
    });
  };

  const setRuleComment = (groupName: string, comment: string) => {
    setState((current) => ({
      ...current,
      ruleComments: {
        ...current.ruleComments,
        [groupName]: comment
      }
    }));
  };

  const commitRuleComment = (groupName: string, comment: string) => {
    recordAction({
      entityType: "root_group",
      entityId: groupName,
      actionType: "rule_comment_updated",
      fromValue: state.ruleComments[groupName] ?? "",
      toValue: comment,
      note: comment,
      metadata: { groupName, round: state.round }
    });
  };

  const rerun = () => {
    const currentRound = state.round;
    const decisionCount = Object.keys(state.decisions).length;
    setState((current) => {
      const nextMemory = [
        ...current.memory,
        {
          id: crypto.randomUUID(),
          round: current.round,
          createdAt: new Date().toISOString(),
          decisions: current.decisions
        }
      ].slice(-5);
      const locked = Object.fromEntries(Object.entries(current.decisions).filter(([, decision]) => decision.status === "approved"));

      return {
        round: current.round + 1,
        decisions: locked,
        ruleComments: current.ruleComments,
        memory: nextMemory
      };
    });
    recordAction({
      entityType: "root_round",
      entityId: String(currentRound),
      actionType: "rerun_next_round",
      fromValue: String(currentRound),
      toValue: String(currentRound + 1),
      metadata: { round: currentRound, decisionCount }
    });
  };

  const confirmAndGenerate = useCallback(async () => {
    if (isGenerating) return;
    const snapshot = buildSnapshot(config, state, stats);
    recordAction({
      entityType: "root_round",
      entityId: String(state.round),
      actionType: "kol_generation_confirm_click",
      fromValue: "root_selection",
      toValue: "generation_requested",
      metadata: {
        round: state.round,
        summary: stats
      }
    });

    try {
      setSubmittingGeneration(true);
      const result = await createRootAudienceGeneration({
        campaignId,
        actorRole: "client",
        snapshot
      });
      onGenerated?.(result.run);
      recordAction({
        entityType: "generation_run",
        entityId: result.run.id,
        actionType: "kol_generation_created",
        fromValue: "generation_requested",
        toValue: result.run.status,
        metadata: {
          round: state.round,
          versionLabel: result.run.versionLabel,
          itemCount: result.run.itemCount,
          sourceSnapshotId: result.snapshot.id
        }
      });
    } catch (error) {
      onActionError?.(error instanceof Error ? error.message : "更新 KOL list 失败，请稍后重试。");
    } finally {
      setSubmittingGeneration(false);
    }
  }, [campaignId, config, isGenerating, onActionError, onGenerated, state, stats]);

  const actionableRootCount = stats.approved + stats.question + stats.rejected;
  const generateDisabled = isGenerating || actionableRootCount < 1;
  const generateLabel = isGenerating ? "更新中" : actionableRootCount < 1 ? "先标记 1 个 root 再更新" : "从 107 基础池更新 KOL list";
  const resetDisabled = actionableRootCount === 0 && Object.keys(state.ruleComments).length === 0 && state.memory.length === 0 && state.round === 1;

  useEffect(() => {
    onGenerateControlChange?.({
      run: confirmAndGenerate,
      disabled: generateDisabled,
      label: generateLabel,
      approved: actionableRootCount
    });
  }, [actionableRootCount, confirmAndGenerate, generateDisabled, generateLabel, onGenerateControlChange]);

  useEffect(() => {
    return () => onGenerateControlChange?.(null);
  }, [onGenerateControlChange]);

  const rollback = () => {
    const previous = state.memory.at(-1);
    setState((current) => {
      const previous = current.memory.at(-1);
      if (!previous) return current;
      return {
        round: previous.round,
        decisions: previous.decisions,
        ruleComments: current.ruleComments,
        memory: current.memory.slice(0, -1)
      };
    });
    if (previous) {
      recordAction({
        entityType: "root_round",
        entityId: String(state.round),
        actionType: "rollback_round",
        fromValue: String(state.round),
        toValue: String(previous.round),
        metadata: { restoredRound: previous.round, restoredDecisionCount: Object.keys(previous.decisions).length }
      });
    }
  };

  const resetRootAudience = () => {
    const previousRound = state.round;
    const decisionCount = Object.keys(state.decisions).length;
    const commentCount = Object.values(state.ruleComments).filter((comment) => comment.trim().length > 0).length;
    setActiveHandle(null);
    setState({
      round: 1,
      decisions: {},
      ruleComments: {},
      memory: []
    });
    recordAction({
      entityType: "root_round",
      entityId: String(previousRound),
      actionType: "reset_root_audience",
      fromValue: String(previousRound),
      toValue: "1",
      metadata: { previousRound, decisionCount, commentCount, memoryRounds: state.memory.length }
    });
  };

  const toggleRules = (groupName: string, open: boolean) => {
    setExpandedRules((current) => ({ ...current, [groupName]: !open }));
    recordAction({
      entityType: "root_group",
      entityId: groupName,
      actionType: open ? "rules_collapse" : "rules_expand",
      fromValue: open ? "open" : "closed",
      toValue: open ? "closed" : "open",
      metadata: { groupName, round: state.round }
    });
  };

  const togglePerson = (person: RootPersonConfig, groupName: string) => {
    const willOpen = activeHandle !== person.handle;
    setActiveHandle(willOpen ? person.handle : null);
    recordAction({
      entityType: "root_person",
      entityId: person.handle,
      actionType: willOpen ? "popover_open" : "popover_close",
      fromValue: willOpen ? "closed" : "open",
      toValue: willOpen ? "open" : "closed",
      metadata: { personName: person.name, personRole: person.role, groupName, round: state.round }
    });
  };

  const closePerson = (person: RootPersonConfig, groupName: string) => {
    setActiveHandle(null);
    recordAction({
      entityType: "root_person",
      entityId: person.handle,
      actionType: "popover_close",
      fromValue: "open",
      toValue: "closed",
      metadata: { personName: person.name, personRole: person.role, groupName, round: state.round }
    });
  };

  return (
    <section className="section" id="roots">
      <div className="section-inner">
        <div className="section-title root-title-row">
          <div>
            <span className="eyebrow">{config.eyebrow}</span>
            <h2>{config.title}</h2>
            <p>{config.description}</p>
          </div>
          <div className="root-round-panel" aria-label="目标人群确认状态">
            <span>{config.roundLabel} {state.round}</span>
            <strong>{stats.approved}/{stats.total}</strong>
            <small>已通过 root</small>
          </div>
          <button type="button" className="root-title-generate" onClick={confirmAndGenerate} disabled={generateDisabled}>
            <Sparkles size={16} />
            {generateLabel}
          </button>
        </div>

        <div className="root-control-bar">
          <div className="root-status-counts" aria-label="目标人群反馈统计">
            <span>待确认 <strong>{stats.pending}</strong></span>
            <span>已通过 <strong>{stats.approved}</strong></span>
            <span>已排除 <strong>{stats.rejected}</strong></span>
            <span>待补充 <strong>{stats.question}</strong></span>
          </div>
          <div className="root-memory-actions">
            <button type="button" className="root-primary-action" onClick={confirmAndGenerate} disabled={generateDisabled}>
              <Sparkles size={15} />
              {isGenerating ? "更新中" : actionableRootCount < 1 ? "先标记 1 个 root 再更新" : "确认目标人群，更新 KOL list"}
            </button>
            <button type="button" onClick={rerun}>
              <Sparkles size={15} />
              {config.rerunButton}
            </button>
            <button type="button" onClick={rollback} disabled={state.memory.length === 0}>
              <RotateCcw size={15} />
              {config.rollbackButton}
            </button>
            <button type="button" onClick={resetRootAudience} disabled={resetDisabled}>
              <Trash2 size={15} />
              重置
            </button>
          </div>
        </div>

        <div className="root-groups">
          {config.groups.map((group) => {
            const rulesOpen = expandedRules[group.name] ?? false;
            return (
              <article className="root-group" key={group.name}>
                <aside className="root-group-intro">
                  <span className="root-group-badge">{group.index} · {group.people.length} roots</span>
                  <h3>{group.name}</h3>
                  <p>{group.note}</p>
                  <div className="root-group-use">{group.use}</div>
                </aside>

                <div className="root-group-main">
                  <article className={`root-rule-card ${rulesOpen ? "is-open" : ""}`}>
                    <button className="root-rule-head" type="button" onClick={() => toggleRules(group.name, rulesOpen)} aria-expanded={rulesOpen}>
                      <div>
                        <span>{group.index} · category rule</span>
                        <h4>{group.name} 的细分规则</h4>
                        <p>{group.goal}</p>
                      </div>
                      <strong>{rulesOpen ? "收起" : "展开"}</strong>
                    </button>
                    {rulesOpen && (
                      <div className="root-rule-window">
                        {group.rules.map((section) => (
                          <section key={section.title}>
                            <h5>{section.title}</h5>
                            <ul>
                              {section.rules.map((rule) => (
                                <li key={rule}>{rule}</li>
                              ))}
                            </ul>
                          </section>
                        ))}
                        <label className="root-rule-comment">
                          <span>
                            <MessageSquareText size={13} />
                            Comment
                          </span>
                          <textarea
                            value={state.ruleComments[group.name] ?? ""}
                            onChange={(event) => setRuleComment(group.name, event.target.value)}
                            onBlur={(event) => commitRuleComment(group.name, event.target.value)}
                            placeholder="对这一类目标人群或细分规则写补充意见"
                            rows={3}
                          />
                        </label>
                      </div>
                    )}
                  </article>

                  <div className="root-person-grid">
                    {group.people.map((person) => (
                      <RootPersonCard
                        key={person.handle}
                        person={person}
                        decision={state.decisions[person.handle]}
                        isActive={activeHandle === person.handle}
                        onToggle={() => togglePerson(person, group.name)}
                        onClose={() => closePerson(person, group.name)}
                        onDecide={(rootPerson, status, reason) => decide(rootPerson, status, reason, group.name)}
                        onNote={setNote}
                        onNoteCommit={(rootPerson, note) => commitNote(rootPerson, note, group.name)}
                        onUndo={(rootPerson) => undoDecision(rootPerson, group.name)}
                        lockedCopy={config.lockedCopy}
                      />
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function RootPersonCard({
  person,
  decision,
  isActive,
  onToggle,
  onClose,
  onDecide,
  onNote,
  onNoteCommit,
  onUndo,
  lockedCopy
}: {
  person: RootPersonConfig;
  decision?: RootDecision;
  isActive: boolean;
  onToggle: () => void;
  onClose: () => void;
  onDecide: (person: RootPersonConfig, status: RootStatus, reason?: string) => void;
  onNote: (person: RootPersonConfig, note: string) => void;
  onNoteCommit: (person: RootPersonConfig, note: string) => void;
  onUndo: (person: RootPersonConfig) => void;
  lockedCopy: string;
}) {
  const status = decision?.status ?? "pending";

  return (
    <article className={`root-person-card is-${status}`}>
      <div className="root-person-main">
        <button className="root-person-toggle" type="button" onClick={onToggle} aria-expanded={isActive}>
          <div className="root-avatar" aria-hidden>
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials(person.name)}</span>}
          </div>
          <strong className="root-person-title">{person.name}</strong>
        </button>
        <a className="root-person-link" href={xProfileUrl(person.handle)} target="_blank" rel="noreferrer" aria-label={`打开 ${person.name} 的 X 主页`}>
          {person.handle}
          <ExternalLink size={10} />
        </a>
        <StatusChip status={status} />
      </div>

      {isActive && (
        <aside className="root-person-popover" role="dialog" aria-label={`${person.name} 判断依据`}>
          <div className="root-popover-head">
            <div>
              <strong>判断依据</strong>
              <p className="root-popover-role">{person.role}</p>
            </div>
            <button type="button" className="root-popover-close" onClick={onClose} aria-label="关闭详情">
              <X size={16} />
            </button>
          </div>
          <dl>
            <dt>为什么相关</dt>
            <dd>{person.why}</dd>
            <dt>互动习惯</dt>
            <dd>{person.behavior}</dd>
            <dt>证据 / 打法</dt>
            <dd>{person.evidence}</dd>
          </dl>

          <div className="root-decision-row" aria-label={`确认 ${person.name}`}>
            <button type="button" className={status === "approved" ? "active approve" : "approve"} onClick={() => onDecide(person, "approved")}>
              <CheckCircle2 size={14} />
              通过
            </button>
            <button type="button" className={status === "rejected" ? "active reject" : "reject"} onClick={() => onDecide(person, "rejected", rejectReasons[0])}>
              <XCircle size={14} />
              排除
            </button>
            <button type="button" className={status === "question" ? "active question" : "question"} onClick={() => onDecide(person, "question")}>
              <CircleHelp size={14} />
              需补充
            </button>
          </div>

          {status !== "pending" && (
            <div className="root-utility-row">
              <button type="button" className="root-utility root-undo" onClick={() => onUndo(person)}>
                <Undo2 size={13} />
                撤回
              </button>
            </div>
          )}

          {status === "approved" && (
            <div className="root-inline-state locked">
              <LockKeyhole size={13} />
              {lockedCopy}
            </div>
          )}

          {status === "rejected" && (
            <div className="root-inline-state">
              <span>排除原因</span>
              <div className="root-reason-row">
                {rejectReasons.map((reason) => (
                  <button key={reason} type="button" className={decision?.reason === reason ? "selected" : ""} onClick={() => onDecide(person, "rejected", reason)}>
                    {reason}
                  </button>
                ))}
              </div>
            </div>
          )}

          {status === "question" && (
            <label className="root-inline-state root-question-field">
              <span>需补充的问题</span>
              <textarea
                value={decision?.note ?? ""}
                onChange={(event) => onNote(person, event.target.value)}
                onBlur={(event) => onNoteCommit(person, event.target.value)}
                placeholder="写明需要补充确认的判断依据"
                rows={2}
              />
            </label>
          )}
        </aside>
      )}
    </article>
  );
}

function StatusChip({ status }: { status: RootStatus }) {
  const label = status === "approved" ? "已通过" : status === "rejected" ? "已排除" : status === "question" ? "待补充" : "待确认";
  return <span className={`root-status-chip is-${status}`}>{label}</span>;
}

function summarizeRootDecisions(config: RootAudienceConfig, decisions: Record<string, RootDecision>) {
  const total = config.groups.reduce((sum, group) => sum + group.people.length, 0);
  const summary = { total, pending: 0, approved: 0, rejected: 0, question: 0 };
  config.groups.forEach((group) => {
    group.people.forEach((person) => {
      const status = decisions[person.handle]?.status ?? "pending";
      summary[status] += 1;
    });
  });
  return summary;
}

function buildSnapshot(config: RootAudienceConfig, state: RootAudienceState, summary: ReturnType<typeof summarizeRootDecisions>): RootAudienceSnapshotInput {
  return {
    round: state.round,
    decisions: state.decisions,
    ruleComments: state.ruleComments,
    summary,
    groups: config.groups.map((group) => ({
      name: group.name,
      people: group.people.map((person) => {
        const decision = state.decisions[person.handle];
        return {
          name: person.name,
          handle: person.handle,
          role: person.role,
          status: decision?.status ?? "pending",
          reason: decision?.reason,
          note: decision?.note
        };
      })
    }))
  };
}

function readState(storageKey: string): RootAudienceState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "");
    if (parsed && typeof parsed === "object") {
      return {
        round: Number(parsed.round ?? 1),
        decisions: parsed.decisions ?? {},
        ruleComments: parsed.ruleComments ?? {},
        memory: Array.isArray(parsed.memory) ? parsed.memory : []
      };
    }
  } catch {
    // Ignore malformed local state and start from a clean round.
  }
  return { round: 1, decisions: {}, ruleComments: {}, memory: [] };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function xProfileUrl(handle: string) {
  const username = handle.trim().replace(/^@/, "").split(/[/?#]/)[0] ?? "";
  return `https://x.com/${encodeURIComponent(username)}`;
}
