'use client';

import { Listing } from '@/lib/types';
import { ListingCard } from './ListingCard';
import { useI18n } from '@/lib/i18n';

interface ListingGridProps {
  listings: Listing[];
  isLoading: boolean;
}

export function ListingGrid({ listings, isLoading }: ListingGridProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-2xl border border-border/50 overflow-hidden animate-pulse">
            <div className="aspect-[16/10] bg-muted" />
            <div className="p-4 space-y-3">
              <div className="h-7 bg-muted rounded-lg w-24" />
              <div className="h-4 bg-muted rounded-lg w-3/4" />
              <div className="flex gap-3">
                <div className="h-3 bg-muted rounded-lg w-12" />
                <div className="h-3 bg-muted rounded-lg w-12" />
                <div className="h-3 bg-muted rounded-lg w-16" />
              </div>
              <div className="h-3 bg-muted rounded-lg w-full" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
          <svg className="w-8 h-8 text-muted-foreground/40" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-foreground/80 mb-1">{t('empty.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('empty.desc')}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
      {listings.map((listing, index) => (
        <ListingCard key={listing.id} listing={listing} priority={index < 3} />
      ))}
    </div>
  );
}
