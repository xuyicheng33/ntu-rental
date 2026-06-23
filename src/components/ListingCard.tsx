'use client';

import Image from 'next/image';
import { Listing } from '@/lib/types';
import { getAreaByName } from '@/lib/ntu-distance';
import { useI18n } from '@/lib/i18n';

interface ListingCardProps {
  listing: Listing;
  priority?: boolean;
}

export function ListingCard({ listing, priority = false }: ListingCardProps) {
  const { t } = useI18n();
  const areaInfo = getAreaByName(listing.area);
  const source = listing.source || 'PropertyGuru';
  const isStudio = /studio/i.test(`${listing.title} ${listing.url}`);

  return (
    <a
      href={listing.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block bg-card rounded-2xl border border-border/50 hover:border-border hover:shadow-lg hover:shadow-black/5 transition-all duration-300 hover:-translate-y-0.5 overflow-hidden"
    >
      {/* Image */}
      <div className="aspect-[16/10] bg-muted relative overflow-hidden">
        {listing.imageUrl ? (
          <Image
            src={listing.imageUrl}
            alt={listing.title}
            fill
            loading={priority ? 'eager' : 'lazy'}
            sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <svg className="w-12 h-12 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" strokeWidth="1" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
            </svg>
          </div>
        )}
        <div className="absolute top-3 left-3">
          <span className="px-2.5 py-1 text-xs font-medium bg-background/90 backdrop-blur-sm rounded-lg">
            {listing.propertyType}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-bold tracking-tight">
            ${listing.price.toLocaleString()}
          </span>
          <span className="text-xs text-muted-foreground">{t('listing.month')}</span>
        </div>

        <h3 className="text-sm font-medium line-clamp-2 text-foreground/80 group-hover:text-foreground transition-colors">
          {listing.title}
        </h3>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {(listing.bedrooms > 0 || isStudio) && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
              {isStudio ? 'Studio' : `${listing.bedrooms} BR`}
            </span>
          )}
          {listing.bathrooms > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {listing.bathrooms} BA
            </span>
          )}
          {listing.floorSize > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
              </svg>
              {listing.floorSize} sqft
            </span>
          )}
          {listing.bedrooms === 0 && !isStudio && listing.bathrooms === 0 && listing.floorSize === 0 && (
            <span className="flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
            </svg>
              Details on source
            </span>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground line-clamp-1">{listing.address}</p>
          {listing.area && (
            <div className="flex items-center gap-1.5">
              <span className="px-2 py-0.5 text-xs bg-muted rounded-md">{listing.area}</span>
              {areaInfo && (
                <span className="text-xs text-muted-foreground">
                  {areaInfo.commuteToNtu} to NTU
                </span>
              )}
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-border/50">
          <span className="text-xs font-medium text-foreground/60 group-hover:text-foreground transition-colors flex items-center gap-1">
            {t('listing.viewOn')} {source}
            <svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </span>
        </div>
      </div>
    </a>
  );
}
