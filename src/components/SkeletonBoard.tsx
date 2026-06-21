export function SkeletonBoard() {
  return (
    <div className="skeleton-layout" aria-label="正在加载候选名单">
      <div className="summary-skeleton shimmer" />
      <div className="filter-skeleton shimmer" />
      <div className="kol-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <article className="skeleton-card shimmer" key={index}>
            <div className="skeleton-head">
              <div />
              <span />
            </div>
            <p />
            <p />
            <section />
            <footer />
          </article>
        ))}
      </div>
    </div>
  );
}
