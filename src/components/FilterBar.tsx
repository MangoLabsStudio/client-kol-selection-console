import { Filter, Search, SlidersHorizontal, X } from "lucide-react";
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

      <div className="status-tabs" role="tablist" aria-label="评审状态筛选">
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={filters.status === status}
            className={filters.status === status ? "active" : ""}
            onClick={() => set("status", status)}
          >
            {status === "all" ? "全部" : statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="filter-grid">
        <FilterSelect icon={<SlidersHorizontal size={15} />} label="平台" value={filters.platform} options={platforms} onChange={(value) => set("platform", value)} />
        <FilterSelect label="内容方向" value={filters.category} options={categories} formatOption={formatContentCategory} onChange={(value) => set("category", value)} />
        <FilterSelect label="语言" value={filters.language} options={languages} onChange={(value) => set("language", value)} />
        <FilterSelect label="地区" value={filters.region} options={regions} onChange={(value) => set("region", value)} />
        <FilterSelect
          label="粉丝规模"
          value={filters.followers}
          options={["<100k", "100k-250k", "250k-750k", "750k+"]}
          formatOption={formatFollowerRange}
          onChange={(value) => set("followers", value)}
        />
        <FilterSelect label="联系状态" value={filters.contactStatus} options={contacts} formatOption={formatContactStatus} onChange={(value) => set("contactStatus", value)} />
        <FilterSelect label="风险项" value={filters.riskTag} options={risks} formatOption={formatRiskTag} onChange={(value) => set("riskTag", value)} />
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  icon,
  formatOption = (option: string) => option
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
  formatOption?: (option: string) => string;
}) {
  return (
    <label className="filter-select">
      <span>
        {icon}
        {label}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">全部</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
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
