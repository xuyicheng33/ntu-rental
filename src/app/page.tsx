'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { FilterPanel } from '@/components/FilterPanel';
import { ListingGrid } from '@/components/ListingGrid';
import { StatsBar } from '@/components/StatsBar';
import { ScrapeProgressOverlay } from '@/components/ScrapeProgress';
import { useI18n } from '@/lib/i18n';
import { Listing, FilterState } from '@/lib/types';
import { DEFAULT_FILTERS } from '@/lib/filter-defaults';
import { filterAndSortListings, type ListingDataPayload } from '@/lib/listing-query';
import type { ScrapeProgress } from '@/lib/scraper';
import staticListingData from '../../data/listing.json';

type StartPropertyGuruSession = (options?: { replaceProgressMessage?: boolean }) => Promise<void>;

const IS_STATIC_SITE = process.env.NEXT_PUBLIC_STATIC_SITE === 'true';
const STATIC_DATA = staticListingData as ListingDataPayload;
const STATIC_LISTINGS = Array.isArray(STATIC_DATA.listings) ? STATIC_DATA.listings : [];

function needsPropertyGuruSession(progress: ScrapeProgress) {
  return progress.action === 'propertyguru-session' ||
    (progress.phase === 'error' && /PropertyGuru|Cloudflare|propertyguru:session/i.test(progress.message));
}

export default function Home() {
  const { t } = useI18n();
  const [listings, setListings] = useState<Listing[]>([]);
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<ScrapeProgress | null>(null);
  const [isSampleData, setIsSampleData] = useState(false);
  const [scrapeSource, setScrapeSource] = useState('auto');
  const [isStartingPropertyGuruSession, setIsStartingPropertyGuruSession] = useState(false);
  const [isPollingPropertyGuruSession, setIsPollingPropertyGuruSession] = useState(false);
  const startPropertyGuruSessionRef = useRef<StartPropertyGuruSession | null>(null);

  const fetchListings = useCallback(async (currentFilters: FilterState, signal?: AbortSignal) => {
    setIsLoading(true);
    if (IS_STATIC_SITE) {
      setListings(filterAndSortListings(STATIC_LISTINGS, currentFilters));
      setLastUpdated(STATIC_DATA.lastUpdated || null);
      setIsSampleData(STATIC_LISTINGS.length === 0);
      setIsLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams();
      if (currentFilters.minPrice > 0) params.set('minPrice', String(currentFilters.minPrice));
      if (currentFilters.maxPrice < 5000) params.set('maxPrice', String(currentFilters.maxPrice));
      if (currentFilters.bedrooms.length > 0) params.set('bedrooms', currentFilters.bedrooms.join(','));
      if (currentFilters.bathrooms.length > 0) params.set('bathrooms', currentFilters.bathrooms.join(','));
      if (currentFilters.areas.length > 0) params.set('areas', currentFilters.areas.join(','));
      if (currentFilters.propertyTypes.length > 0) params.set('propertyTypes', currentFilters.propertyTypes.join(','));
      params.set('sortBy', currentFilters.sortBy);

      const res = await fetch(`/api/listings?${params.toString()}`, { signal });
      if (!res.ok) throw new Error(`Listings request failed: ${res.status}`);
      const data = await res.json();
      setListings(data.listings);
      if (data.lastUpdated) setLastUpdated(data.lastUpdated);
      setIsSampleData(Boolean(data.isSampleData));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to fetch listings:', err);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, []);

  const fetchAllListings = useCallback(async (signal?: AbortSignal) => {
    if (IS_STATIC_SITE) {
      setAllListings(filterAndSortListings(STATIC_LISTINGS, DEFAULT_FILTERS));
      setLastUpdated(STATIC_DATA.lastUpdated || null);
      setIsSampleData(STATIC_LISTINGS.length === 0);
      return;
    }

    try {
      const res = await fetch('/api/listings?sortBy=newest', { signal });
      if (!res.ok) throw new Error(`Listings request failed: ${res.status}`);
      const data = await res.json();
      setAllListings(data.listings);
      if (data.lastUpdated) setLastUpdated(data.lastUpdated);
      setIsSampleData(Boolean(data.isSampleData));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetchListings(filters, controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [filters, fetchListings]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetchAllListings(controller.signal);
    }, 0);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [fetchAllListings]);

  const refreshWithSource = useCallback(async (source: string, autoStartSession = true) => {
    if (IS_STATIC_SITE) return;

    setIsRefreshing(true);
    setScrapeProgress({ phase: 'starting', currentPage: 0, totalPages: 3, listingsFound: 0, message: t('progress.starting') });

    try {
      const res = await fetch(`/api/scrape?source=${encodeURIComponent(source)}`, { method: 'POST' });
      if (!res.ok) throw new Error(`Scrape request failed: ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('Scrape response did not include a stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalProgress: ScrapeProgress | null = null;
      let startedPropertyGuruSession = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const progress: ScrapeProgress = JSON.parse(line.slice(6));
              setScrapeProgress(progress);
              finalProgress = progress;
              if (autoStartSession && needsPropertyGuruSession(progress) && !startedPropertyGuruSession) {
                startedPropertyGuruSession = true;
                void startPropertyGuruSessionRef.current?.({ replaceProgressMessage: true });
              }
            } catch {}
          }
        }
      }

      if (finalProgress?.phase === 'error') {
        throw new Error(finalProgress.message);
      }

      await fetchListings(filters);
      await fetchAllListings();
    } catch (err) {
      console.error('Failed to refresh:', err);
      const message = err instanceof Error ? err.message : t('progress.failed');
      setScrapeProgress(prev => prev ? { ...prev, phase: 'error', message } : null);
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchAllListings, fetchListings, filters, t]);

  const handleRefresh = async () => {
    if (IS_STATIC_SITE) return;
    await refreshWithSource(scrapeSource);
  };

  const handleCloseProgress = () => {
    setScrapeProgress(null);
  };

  const pollPropertyGuruSession = useCallback(async () => {
    if (isPollingPropertyGuruSession) return;
    setIsPollingPropertyGuruSession(true);

    try {
      for (let i = 0; i < 120; i++) {
        const res = await fetch('/api/propertyguru/session');
        if (!res.ok) throw new Error(`PropertyGuru session status failed: ${res.status}`);
        const data = await res.json();
        const state = data.status?.state;

        if (state === 'saved') {
          setScrapeProgress(prev => prev
            ? { ...prev, message: t('propertyguru.sessionSaved') }
            : prev
          );
          setScrapeSource('propertyguru');
          await refreshWithSource('propertyguru', false);
          return;
        }

        if (state === 'opened-default-browser') {
          setScrapeProgress(prev => prev
            ? { ...prev, message: t('propertyguru.sessionStarted') }
            : prev
          );
          return;
        }

        if (state === 'failed') {
          const message = data.status?.error || t('propertyguru.sessionFailed');
          setScrapeProgress(prev => prev
            ? { ...prev, phase: 'error', message }
            : prev
          );
          return;
        }

        await new Promise(resolve => window.setTimeout(resolve, 3000));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('propertyguru.sessionFailed');
      setScrapeProgress(prev => prev ? { ...prev, phase: 'error', message } : null);
    } finally {
      setIsPollingPropertyGuruSession(false);
    }
  }, [isPollingPropertyGuruSession, refreshWithSource, t]);

  const startPropertyGuruSession = useCallback<StartPropertyGuruSession>(async ({ replaceProgressMessage = true } = {}) => {
    setIsStartingPropertyGuruSession(true);
    try {
      const res = await fetch('/api/propertyguru/session', { method: 'POST' });
      if (!res.ok) throw new Error(`PropertyGuru session request failed: ${res.status}`);
      const data = await res.json();
      if (replaceProgressMessage) {
        setScrapeProgress(prev => prev
          ? { ...prev, message: data.message || t('propertyguru.sessionStarted') }
          : prev
        );
      }
      void pollPropertyGuruSession();
    } catch (err) {
      const message = err instanceof Error ? err.message : t('propertyguru.sessionFailed');
      setScrapeProgress(prev => prev ? { ...prev, phase: 'error', message } : null);
    } finally {
      setIsStartingPropertyGuruSession(false);
    }
  }, [pollPropertyGuruSession, t]);

  useEffect(() => {
    startPropertyGuruSessionRef.current = startPropertyGuruSession;
  }, [startPropertyGuruSession]);

  return (
    <div className="min-h-screen bg-background">
      <Header
        lastUpdated={lastUpdated}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        scrapeSource={scrapeSource}
        onScrapeSourceChange={setScrapeSource}
        isStaticSite={IS_STATIC_SITE}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Hero */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight mb-2">{t('hero.title')}</h2>
          <p className="text-muted-foreground max-w-2xl">{t('hero.desc')}</p>
          {isSampleData && (
            <p className="mt-3 inline-flex rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
              {t('data.sampleWarning')}
            </p>
          )}
        </div>

        {/* Stats */}
        <div className="mb-8">
          <StatsBar listings={allListings} />
        </div>

        {/* Mobile filter toggle */}
        <div className="lg:hidden mb-4">
          <button
            onClick={() => setShowMobileFilters(!showMobileFilters)}
            className="w-full flex items-center justify-between px-4 py-3 bg-card rounded-xl border border-border/50 text-sm font-medium"
          >
            <span>{t('filter.title')}</span>
            <svg
              className={`w-4 h-4 transition-transform ${showMobileFilters ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>
        </div>

        {/* Layout */}
        <div className="flex flex-col lg:flex-row gap-8">
          <aside className={`lg:w-72 lg:shrink-0 ${showMobileFilters ? 'block' : 'hidden lg:block'}`}>
            <div className="sticky top-24 bg-card rounded-2xl border border-border/50 p-5">
              <FilterPanel
                filters={filters}
                onChange={setFilters}
                totalResults={listings.length}
              />
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <ListingGrid listings={listings} isLoading={isLoading} />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 mt-16">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <p className="text-xs text-muted-foreground text-center">{t('footer.disclaimer')}</p>
        </div>
      </footer>

      {/* Progress overlay */}
      {!IS_STATIC_SITE && (
        <ScrapeProgressOverlay
          progress={scrapeProgress}
          onClose={handleCloseProgress}
          onStartPropertyGuruSession={startPropertyGuruSession}
          isStartingPropertyGuruSession={isStartingPropertyGuruSession}
        />
      )}
    </div>
  );
}
