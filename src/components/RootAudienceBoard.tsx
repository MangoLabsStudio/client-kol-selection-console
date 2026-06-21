import { CheckCircle2, CircleHelp, ExternalLink, LockKeyhole, MessageSquareText, RotateCcw, Sparkles, Undo2, X, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RootAudienceConfig, RootPersonConfig } from "../lib/types";

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
  config: RootAudienceConfig;
};

const rejectReasons = ["目标层级不匹配", "议题关联不足", "本轮不优先", "需要换一批"];

export function RootAudienceBoard({ config }: RootAudienceBoardProps) {
  const [state, setState] = useState<RootAudienceState>(() => readState(config.storageKey));
  const [expandedRules, setExpandedRules] = useState<Record<string, boolean>>({});
  const [activeHandle, setActiveHandle] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(config.storageKey, JSON.stringify(state));
  }, [config.storageKey, state]);

  const stats = useMemo(() => summarizeRootDecisions(config, state.decisions), [config, state.decisions]);

  const decide = (person: RootPersonConfig, status: RootStatus, reason?: string) => {
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
  };

  const undoDecision = (person: RootPersonConfig) => {
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

  const setRuleComment = (groupName: string, comment: string) => {
    setState((current) => ({
      ...current,
      ruleComments: {
        ...current.ruleComments,
        [groupName]: comment
      }
    }));
  };

  const rerun = () => {
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
  };

  const rollback = () => {
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
        </div>

        <div className="root-control-bar">
          <div className="root-status-counts" aria-label="目标人群反馈统计">
            <span>待确认 <strong>{stats.pending}</strong></span>
            <span>已通过 <strong>{stats.approved}</strong></span>
            <span>已排除 <strong>{stats.rejected}</strong></span>
            <span>待补充 <strong>{stats.question}</strong></span>
          </div>
          <div className="root-memory-actions">
            <button type="button" onClick={rerun}>
              <Sparkles size={15} />
              {config.rerunButton}
            </button>
            <button type="button" onClick={rollback} disabled={state.memory.length === 0}>
              <RotateCcw size={15} />
              {config.rollbackButton}
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
                    <button className="root-rule-head" type="button" onClick={() => setExpandedRules((current) => ({ ...current, [group.name]: !rulesOpen }))} aria-expanded={rulesOpen}>
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
                        onToggle={() => setActiveHandle((current) => (current === person.handle ? null : person.handle))}
                        onClose={() => setActiveHandle(null)}
                        onDecide={decide}
                        onNote={setNote}
                        onUndo={undoDecision}
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
  onUndo: (person: RootPersonConfig) => void;
  lockedCopy: string;
}) {
  const status = decision?.status ?? "pending";

  return (
    <article className={`root-person-card is-${status}`}>
      <button className="root-person-main" type="button" onClick={onToggle} aria-expanded={isActive}>
        <div className="root-avatar" aria-hidden>
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initials(person.name)}</span>}
        </div>
        <div className="root-person-name">
          <strong>{person.name}</strong>
          <span>
            {person.handle}
            <ExternalLink size={10} />
          </span>
        </div>
        <StatusChip status={status} />
      </button>

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
              <textarea value={decision?.note ?? ""} onChange={(event) => onNote(person, event.target.value)} placeholder="写明需要补充确认的判断依据" rows={2} />
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
