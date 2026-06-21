import { GitBranch, Layers3, Route, ShieldCheck } from "lucide-react";
import type { MethodConfig, SignalLogicConfig } from "../lib/types";

type StrategyMethodBoardProps = {
  method?: MethodConfig;
  signalLogic?: SignalLogicConfig;
  dataNote?: string;
};

export function StrategyMethodBoard({ method, signalLogic, dataNote }: StrategyMethodBoardProps) {
  return (
    <>
      {method && (
        <section className="section" id="method">
          <div className="section-inner">
            <div className="section-title">
              <span className="eyebrow">{method.eyebrow}</span>
              <h2>{method.title}</h2>
              <p>{method.description}</p>
            </div>

            <div className="method-board">
              <div className="axis-grid">
                {method.axes.map((axis) => (
                  <article className="method-axis" key={axis.title}>
                    <div className="method-axis-head">
                      <GitBranch size={18} />
                      <div>
                        <span>{axis.source}</span>
                        <h3>{axis.title}</h3>
                      </div>
                    </div>
                    <p>{axis.lead}</p>
                    <strong>{axis.take}</strong>
                    <div className="axis-stats">
                      {axis.stats.map(([value, label]) => (
                        <span key={`${axis.title}-${label}`}>
                          <b>{value}</b>
                          {label}
                        </span>
                      ))}
                    </div>
                    <small>{axis.note}</small>
                  </article>
                ))}
              </div>

              <div className="route-ribbon" aria-label="执行路径">
                {method.routes.map((route) => (
                  <article className="route-card" key={route.index}>
                    <span>{route.index}</span>
                    <h3>{route.title}</h3>
                    <strong>{route.subtitle}</strong>
                    <p>{route.description}</p>
                    <div>
                      {route.tags.map((tag) => (
                        <small key={tag}>{tag}</small>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {signalLogic && (
        <section className="section" id="logic">
          <div className="section-inner">
            <div className="section-title">
              <span className="eyebrow">{signalLogic.eyebrow}</span>
              <h2>{signalLogic.title}</h2>
              <p>{signalLogic.description}</p>
            </div>

            <div className="signal-logic">
              <div className="logic-grid">
                {signalLogic.matrix.map((cell) => (
                  <article className={`logic-cell ${cell.tone ? `is-${cell.tone}` : ""}`} key={cell.title}>
                    <Layers3 size={18} />
                    <h3>{cell.title}</h3>
                    <p>{cell.description}</p>
                  </article>
                ))}
              </div>

              <div className="score-legend">
                <div className="score-legend-head">
                  <ShieldCheck size={18} />
                  <strong>执行优先级</strong>
                </div>
                {signalLogic.tiers.map((tier) => (
                  <article key={tier.level}>
                    <span>{tier.level}</span>
                    <div>
                      <h3>{tier.title}</h3>
                      <p>{tier.description}</p>
                    </div>
                  </article>
                ))}
              </div>

              {dataNote && (
                <div className="data-note">
                  <Route size={18} />
                  <p>{dataNote}</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
