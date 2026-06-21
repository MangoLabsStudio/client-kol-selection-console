import { Filter, Search, SlidersHorizontal, X } from "lucide-react";
import type { CampaignKolItem, Filters, SelectionStatus } from "../lib/types";
import { statusLabels } from "../lib/status";

type FilterBarProps = {
  items: CampaignKolItem[];
  filters: Filters;
  resultCount: number;
  onChange: (filters: Filters) => void;
};

const statusOptions: Array<SelectionStatus | "all"> = ["all", "pending", "approved", "rejected", "question", "hold"];

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
    <section className="filter-shell" aria-label="Filter KOL candidates">
      <div className="filter-top">
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input
            value={filters.query}
            onChange={(event) => set("query", event.target.value)}
            placeholder="Search name, handle, angle, audience, risk"
            aria-label="Search KOL candidates"
          />
        </div>
        <div className="filter-result">
          <Filter size={16} aria-hidden />
          <strong>{resultCount}</strong>
          <span>shown</span>
        </div>
        <button className="quiet-button" type="button" onClick={clear}>
          <X size={16} />
          Clear
        </button>
      </div>

      <div className="status-tabs" role="tablist" aria-label="Status filter">
        {statusOptions.map((status) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={filters.status === status}
            className={filters.status === status ? "active" : ""}
            onClick={() => set("status", status)}
          >
            {status === "all" ? "All" : statusLabels[status]}
          </button>
        ))}
      </div>

      <div className="filter-grid">
        <FilterSelect icon={<SlidersHorizontal size={15} />} label="Platform" value={filters.platform} options={platforms} onChange={(value) => set("platform", value)} />
        <FilterSelect label="Category" value={filters.category} options={categories} onChange={(value) => set("category", value)} />
        <FilterSelect label="Language" value={filters.language} options={languages} onChange={(value) => set("language", value)} />
        <FilterSelect label="Region" value={filters.region} options={regions} onChange={(value) => set("region", value)} />
        <FilterSelect
          label="Followers"
          value={filters.followers}
          options={["<100k", "100k-250k", "250k-750k", "750k+"]}
          onChange={(value) => set("followers", value)}
        />
        <FilterSelect label="Contact" value={filters.contactStatus} options={contacts} onChange={(value) => set("contactStatus", value)} />
        <FilterSelect label="Risk" value={filters.riskTag} options={risks} onChange={(value) => set("riskTag", value)} />
      </div>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  icon
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="filter-select">
      <span>
        {icon}
        {label}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}
