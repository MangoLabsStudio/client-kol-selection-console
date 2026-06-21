import { Filter, Search, X } from "lucide-react";
import type { CampaignKolItem, Filters, SelectionStatus } from "../lib/types";
import { formatContactStatus, formatContentCategory, formatRiskTag, statusLabels } from "../lib/status";

type FilterBarProps = {
  items: CampaignKolItem[];
  filters: Filters;
  resultCount: number;
  onChange: (filters: Filters) => void;
};

const statusOptions: Array<SelectionStatus | "all"> = ["all", "pending", "approved", "rejected", "question"];

export function FilterBar({ items, filters, resultCount, onChange }: FilterBarProps) {
  const platforms = unique(items.map((item) => item.kol.platform));
  const categories = unique(items.map((item) => item.kol.contentCategory));
  const languages = unique(items.map((item) => item.kol.language));
  const regions = unique(items.map((item) => item.kol.region));
  const contacts = unique(items.map((item) => item.contactStatus));
  const risks = unique(items.flatMap((item) => item.riskTags));

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const clear = () =>
    onChange({
      status: "all",
      platform: "all",
      category: "all",
      language: "all",
      region: "all",
      followers: "all",
      contactStatus: "all",
      riskTag: "all",
      query: ""
    });

  return (
    <section className="filter-shell" aria-label="筛选候选账号">
      <div className="filter-top">
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input
            value={filters.query}
            onChange={(event) => set("query", event.target.value)}
            placeholder="搜索账号、平台、推荐理由或风险项"
            aria-label="搜索候选账号"
          />
        </div>
        <div className="filter-result">
          <Filter size={16} aria-hidden />
          <strong>{resultCount}</strong>
          <span>项结果</span>
        </div>
        <button className="quiet-button" type="button" onClick={clear}>
          <X size={16} />
          清除筛选
        </button>
      </div>

      <div className="filter-pill-panel">
        <PillGroup
          label="评审状态"
          value={filters.status}
          allLabel="全部状态"
          options={statusOptions.filter((status) => status !== "all")}
          formatOption={(status) => statusLabels[status as SelectionStatus]}
          countOption={(status) => countStatus(items, status as SelectionStatus)}
          total={items.length}
          onChange={(value) => set("status", value as SelectionStatus | "all")}
        />
        <PillGroup
          label="内容方向"
          value={filters.category}
          allLabel="全部内容方向"
          options={categories}
          formatOption={formatContentCategory}
          total={items.length}
          countOption={(value) => countBy(items, (item) => item.kol.contentCategory === value)}
          onChange={(value) => set("category", value)}
        />
        <PillGroup
          label="语言"
          value={filters.language}
          allLabel="全部语言"
          options={languages}
          hideIfSingle
          total={items.length}
          countOption={(value) => countBy(items, (item) => item.kol.language === value)}
          onChange={(value) => set("language", value)}
        />
        <PillGroup
          label="地区"
          value={filters.region}
          allLabel="全部地区"
          options={regions}
          hideIfSingle
          total={items.length}
          countOption={(value) => countBy(items, (item) => item.kol.region === value)}
          onChange={(value) => set("region", value)}
        />
        <PillGroup
          label="粉丝规模"
          value={filters.followers}
          allLabel="全部粉丝规模"
          options={["<100k", "100k-250k", "250k-750k", "750k+"]}
          formatOption={formatFollowerRange}
          total={items.length}
          countOption={(value) => countBy(items, (item) => matchesFollowerRange(item.kol.followers, value))}
          onChange={(value) => set("followers", value)}
        />
        <PillGroup
          label="联系状态"
          value={filters.contactStatus}
          allLabel="全部联系状态"
          options={contacts}
          formatOption={formatContactStatus}
          total={items.length}
          countOption={(value) => countBy(items, (item) => item.contactStatus === value)}
          onChange={(value) => set("contactStatus", value)}
        />
        <details className="filter-more" open={filters.platform !== "all" || filters.riskTag !== "all"}>
          <summary>更多筛选</summary>
          <div className="filter-more-panel">
            <PillGroup
              label="平台"
              value={filters.platform}
              allLabel="全部平台"
              options={platforms}
              total={items.length}
              countOption={(value) => countBy(items, (item) => item.kol.platform === value)}
              onChange={(value) => set("platform", value)}
            />
            <PillGroup
              label="风险项"
              value={filters.riskTag}
              allLabel="全部风险项"
              options={risks}
              formatOption={formatRiskTag}
              total={items.length}
              countOption={(value) => countBy(items, (item) => item.riskTags.includes(value))}
              onChange={(value) => set("riskTag", value)}
            />
          </div>
        </details>
      </div>
    </section>
  );
}

function PillGroup({
  label,
  value,
  allLabel,
  options,
  total,
  countOption,
  onChange,
  formatOption = (option: string) => option,
  hideIfSingle = false
}: {
  label: string;
  value: string;
  allLabel: string;
  options: string[];
  total: number;
  countOption: (value: string) => number;
  onChange: (value: string) => void;
  formatOption?: (option: string) => string;
  hideIfSingle?: boolean;
}) {
  if (hideIfSingle && options.length <= 1 && value === "all") return null;

  return (
    <div className="filter-pill-group">
      <h3>{label}</h3>
      <div className="filter-pill-row" role="group" aria-label={`${label}筛选`}>
        <FilterPill active={value === "all"} label={allLabel} count={total} onClick={() => onChange("all")} />
        {options.map((option) => (
          <FilterPill key={option} active={value === option} label={formatOption(option)} count={countOption(option)} onClick={() => onChange(option)} />
        ))}
      </div>
    </div>
  );
}

function FilterPill({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" className={active ? "filter-pill active" : "filter-pill"} aria-pressed={active} onClick={onClick}>
      <span>{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function countStatus(items: CampaignKolItem[], status: SelectionStatus) {
  return countBy(items, (item) => item.currentState.currentStatus === status);
}

function countBy(items: CampaignKolItem[], predicate: (item: CampaignKolItem) => boolean) {
  return items.reduce((count, item) => count + (predicate(item) ? 1 : 0), 0);
}

function matchesFollowerRange(followers: number, range: string) {
  if (range === "<100k") return followers < 100000;
  if (range === "100k-250k") return followers >= 100000 && followers < 250000;
  if (range === "250k-750k") return followers >= 250000 && followers < 750000;
  if (range === "750k+") return followers >= 750000;
  return true;
}

function formatFollowerRange(value: string) {
  const labels: Record<string, string> = {
    "<100k": "10 万以下",
    "100k-250k": "10 万 - 25 万",
    "250k-750k": "25 万 - 75 万",
    "750k+": "75 万以上"
  };

  return labels[value] ?? value;
}
