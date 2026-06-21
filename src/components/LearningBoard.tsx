import { Download, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProjectUiConfig, Summary } from "../lib/types";

type LearningProfile = Record<string, string[]>;

type LearningBoardProps = {
  summary: Summary;
  config: ProjectUiConfig["learning"];
  onExportLearning: (payload: unknown) => void;
};

export function LearningBoard({ summary, config, onExportLearning }: LearningBoardProps) {
  const [profile, setProfile] = useState<LearningProfile>(() => buildDefaultProfile(config));
  const [jsonVisible, setJsonVisible] = useState(false);

  useEffect(() => {
    const defaultProfile = buildDefaultProfile(config);
    try {
      const saved = window.localStorage.getItem(config.storageKey);
      setProfile(saved ? { ...defaultProfile, ...JSON.parse(saved) } : defaultProfile);
    } catch {
      setProfile(defaultProfile);
    }
    setJsonVisible(false);
  }, [config]);

  useEffect(() => {
    try {
      window.localStorage.setItem(config.storageKey, JSON.stringify(profile));
    } catch {
      return;
    }
  }, [config.storageKey, profile]);

  const reviewed = summary.approved + summary.rejected + summary.question + summary.hold;
  const payload = useMemo(
    () => ({
      project: config.exportProject,
      round: config.exportRound,
      preference_profile: profile,
      feedback_summary: {
        reviewed,
        approve: summary.approved,
        reject: summary.rejected,
        question: summary.question,
        hold: summary.hold
      }
    }),
    [config.exportProject, config.exportRound, profile, reviewed, summary.approved, summary.hold, summary.question, summary.rejected]
  );

  const updateRule = (key: string, index: number, value: string) => {
    setProfile((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((rule, ruleIndex) => (ruleIndex === index ? value : rule))
    }));
  };

  const addRule = (key: string) => {
    setProfile((current) => ({
      ...current,
      [key]: [...(current[key] ?? []), "新增判别条件"]
    }));
  };

  const removeRule = (key: string, index: number) => {
    setProfile((current) => ({
      ...current,
      [key]: (current[key] ?? []).filter((_, ruleIndex) => ruleIndex !== index)
    }));
  };

  return (
    <section className="section" id="learning">
      <div className="section-inner">
        <div className="section-title">
          <span className="eyebrow">{config.eyebrow}</span>
          <h2>{config.title}</h2>
          <p>{config.description}</p>
        </div>

        <div className="learning-board">
          <div className="learning-board-head">
            <div>
              <h3>{config.systemTitle}</h3>
              <p>{config.systemDescription}</p>
            </div>
            <div className="learning-stats" aria-label="客户反馈状态">
              <span className="learning-stat">
                已反馈 <strong>{reviewed}</strong>
              </span>
              <span className="learning-stat">
                通过 <strong>{summary.approved}</strong>
              </span>
              <span className="learning-stat">
                排除 <strong>{summary.rejected}</strong>
              </span>
              <span className="learning-stat">
                待补充 <strong>{summary.question}</strong>
              </span>
            </div>
          </div>

          <div className="learning-grid">
            {config.sections.map((section, sectionIndex) => (
              <details className="learning-card" key={section.id} open={section.open}>
                <summary>
                  <div>
                    <h4>{section.title}</h4>
                    <span>{section.subtitle}</span>
                  </div>
                </summary>
                <div className="learning-card-body">
                  <ul className="editable-rule-list">
                    {(profile[section.id] ?? []).map((rule, index) => (
                      <li className="editable-rule-item" key={`${section.id}-${index}`}>
                        <span className="editable-rule-bullet">•</span>
                        <input
                          value={rule}
                          onChange={(event) => updateRule(section.id, index, event.target.value)}
                          aria-label={`${section.title} 条件 ${index + 1}`}
                        />
                        <button type="button" className="rule-remove" onClick={() => removeRule(section.id, index)} aria-label="删除条件">
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="learning-actions">
                    <button className="learning-action" type="button" onClick={() => addRule(section.id)}>
                      <Plus size={14} />
                      增加判别条件
                    </button>
                    {sectionIndex === config.sections.length - 1 && (
                      <button
                        className="learning-action"
                        type="button"
                        onClick={() => {
                          setJsonVisible(true);
                          onExportLearning(payload);
                        }}
                      >
                        <Download size={14} />
                        导出规则 JSON
                      </button>
                    )}
                  </div>
                </div>
              </details>
            ))}
          </div>

          {jsonVisible && <pre className="learning-json">{JSON.stringify(payload, null, 2)}</pre>}
        </div>
      </div>
    </section>
  );
}

function buildDefaultProfile(config: ProjectUiConfig["learning"]): LearningProfile {
  return Object.fromEntries(config.sections.map((section) => [section.id, section.defaultRules])) as LearningProfile;
}
