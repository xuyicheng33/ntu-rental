'use client';

import { AREA_NAMES } from '@/lib/ntu-distance';
import { FilterState } from '@/lib/types';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_FILTERS } from '@/lib/filter-defaults';

interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  totalResults: number;
}

export function FilterPanel({ filters, onChange, totalResults }: FilterPanelProps) {
  const { t } = useI18n();

  const updateFilter = <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const toggleArrayItem = <K extends keyof FilterState>(key: K, item: string | number) => {
    const arr = filters[key] as (string | number)[];
    const newArr = arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
    updateFilter(key, newArr as FilterState[K]);
  };

  const hasActiveFilters = filters.minPrice !== DEFAULT_FILTERS.minPrice
    || filters.maxPrice !== DEFAULT_FILTERS.maxPrice
    || filters.bedrooms.length > 0
    || filters.bathrooms.length > 0
    || filters.areas.length > 0
    || filters.propertyTypes.length > 0
    || filters.sortBy !== DEFAULT_FILTERS.sortBy;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground font-semibold text-base">{totalResults}</span> {t('filter.found')}
        </p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={() =>
              onChange(DEFAULT_FILTERS)
            }
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t('filter.clearAll')}
          </button>
        )}
      </div>

      {/* Price Range */}
      <div className="space-y-3">
        <span id="price-range-label" className="text-sm font-medium">{t('filter.priceRange')}</span>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <input
              id="min-price"
              name="minPrice"
              aria-label={`${t('filter.priceRange')} ${t('filter.min')}`}
              type="number"
              value={filters.minPrice || ''}
              onChange={e => updateFilter('minPrice', Number(e.target.value))}
              placeholder={t('filter.min')}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
            />
          </div>
          <span className="text-muted-foreground text-sm">&ndash;</span>
          <div className="flex-1">
            <input
              id="max-price"
              name="maxPrice"
              aria-label={`${t('filter.priceRange')} ${t('filter.max')}`}
              type="number"
              value={filters.maxPrice || ''}
              onChange={e => updateFilter('maxPrice', Number(e.target.value))}
              placeholder={t('filter.max')}
              className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Bedrooms */}
      <div className="space-y-3">
        <span className="text-sm font-medium">{t('filter.bedrooms')}</span>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4].map(n => (
            <button
              type="button"
              key={n}
              onClick={() => toggleArrayItem('bedrooms', n)}
              aria-pressed={filters.bedrooms.includes(n)}
              className={`px-4 py-2 text-sm rounded-xl border transition-all duration-200 ${
                filters.bedrooms.includes(n)
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card border-border hover:border-foreground/30'
              }`}
            >
              {n} {n === 1 ? t('filter.room') : t('filter.rooms')}
            </button>
          ))}
        </div>
      </div>

      {/* Bathrooms */}
      <div className="space-y-3">
        <span className="text-sm font-medium">{t('filter.bathrooms')}</span>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3].map(n => (
            <button
              type="button"
              key={n}
              onClick={() => toggleArrayItem('bathrooms', n)}
              aria-pressed={filters.bathrooms.includes(n)}
              className={`px-4 py-2 text-sm rounded-xl border transition-all duration-200 ${
                filters.bathrooms.includes(n)
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card border-border hover:border-foreground/30'
              }`}
            >
              {n} {n === 1 ? t('filter.bath') : t('filter.baths')}
            </button>
          ))}
        </div>
      </div>

      {/* Property Type */}
      <div className="space-y-3">
        <span className="text-sm font-medium">{t('filter.propertyType')}</span>
        <div className="flex flex-wrap gap-2">
          {['HDB', 'Condo', 'Room'].map(type => (
            <button
              type="button"
              key={type}
              onClick={() => toggleArrayItem('propertyTypes', type)}
              aria-pressed={filters.propertyTypes.includes(type)}
              className={`px-4 py-2 text-sm rounded-xl border transition-all duration-200 ${
                filters.propertyTypes.includes(type)
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card border-border hover:border-foreground/30'
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Areas */}
      <div className="space-y-3">
        <span className="text-sm font-medium">{t('filter.area')}</span>
        <div className="flex flex-wrap gap-2">
          {AREA_NAMES.map(area => (
            <button
              type="button"
              key={area}
              onClick={() => toggleArrayItem('areas', area)}
              aria-pressed={filters.areas.includes(area)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-all duration-200 ${
                filters.areas.includes(area)
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-card border-border hover:border-foreground/30'
              }`}
            >
              {area}
            </button>
          ))}
        </div>
      </div>

      {/* Sort */}
      <div className="space-y-3">
        <label htmlFor="sort-by" className="text-sm font-medium">{t('filter.sortBy')}</label>
        <select
          id="sort-by"
          name="sortBy"
          value={filters.sortBy}
          onChange={e => updateFilter('sortBy', e.target.value as FilterState['sortBy'])}
          className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-card focus:outline-none focus:ring-2 focus:ring-foreground/10 transition-all appearance-none cursor-pointer"
        >
          <option value="newest">{t('sort.newest')}</option>
          <option value="price-asc">{t('sort.priceAsc')}</option>
          <option value="price-desc">{t('sort.priceDesc')}</option>
          <option value="size-desc">{t('sort.sizeDesc')}</option>
        </select>
      </div>
    </div>
  );
}
