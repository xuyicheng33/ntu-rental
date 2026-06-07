'use client';

import { Listing } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface StatsBarProps {
  listings: Listing[];
}

export function StatsBar({ listings }: StatsBarProps) {
  const { t } = useI18n();

  if (listings.length === 0) return null;

  const prices = listings.map(l => l.price);
  const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const medianPrice = sortedPrices[Math.floor(sortedPrices.length / 2)];

  const stats = [
    { label: t('stats.properties'), value: listings.length.toString() },
    { label: t('stats.avgPrice'), value: `$${avgPrice.toLocaleString()}` },
    { label: t('stats.median'), value: `$${medianPrice.toLocaleString()}` },
    { label: t('stats.range'), value: `$${minPrice.toLocaleString()} – $${maxPrice.toLocaleString()}` },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map(stat => (
        <div key={stat.label} className="bg-card rounded-xl border border-border/50 px-4 py-3">
          <p className="text-xs text-muted-foreground mb-1">{stat.label}</p>
          <p className="text-lg font-semibold tracking-tight">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
