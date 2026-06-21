import { Plus } from "lucide-react";
import type { ProjectUiConfig } from "../lib/types";

type RuleBoardProps = {
  config: ProjectUiConfig["rules"];
};

export function RuleBoard({ config }: RuleBoardProps) {
  return (
    <div className="kol-rule-board" id="rules" aria-label={config.title}>
      <div className="kol-rule-head">
        <div>
          <h3>{config.title}</h3>
          <p>{config.description}</p>
        </div>
        <span className="learning-stat">
          {config.statLabel} <strong>{config.sections.length}</strong>
        </span>
      </div>

      <div className="kol-rule-grid">
        {config.sections.map((section, index) => (
          <details className="learning-card" key={section.title} open={section.open ?? index < 2}>
            <summary>
              <div>
                <h4>{section.title}</h4>
                <span>{section.subtitle}</span>
              </div>
            </summary>
            <div className="learning-card-body">
              <ul>
                {section.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ul>
              <div className="learning-actions">
                <button className="learning-action" type="button">
                  <Plus size={14} />
                  增加判别条件
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
