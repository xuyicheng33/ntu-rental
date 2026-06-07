'use client';

import { useI18n } from '@/lib/i18n';

interface HeaderProps {
  lastUpdated: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  scrapeSource: string;
  onScrapeSourceChange: (source: string) => void;
  isStaticSite?: boolean;
}

export function Header({ lastUpdated, onRefresh, isRefreshing, scrapeSource, onScrapeSourceChange, isStaticSite = false }: HeaderProps) {
  const { lang, setLang, t } = useI18n();

  const formattedDate = lastUpdated
    ? new Date(lastUpdated).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-SG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center">
            <span className="text-background font-bold text-sm">N</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">{t('app.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('app.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {formattedDate && (
            <span className="text-xs text-muted-foreground hidden sm:block">
              {t('header.updated')} {formattedDate}
            </span>
          )}

          {/* Language toggle */}
          <button
            onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border hover:bg-muted transition-all"
          >
            {lang === 'en' ? '中文' : 'EN'}
          </button>

          {!isStaticSite && (
            <select
              id="scrape-source"
              name="scrapeSource"
              value={scrapeSource}
              onChange={(event) => onScrapeSourceChange(event.target.value)}
              disabled={isRefreshing}
              aria-label={t('header.source')}
              className="h-9 rounded-lg border border-border bg-background px-2 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              <option value="auto">{t('source.auto')}</option>
              <option value="propertyguru">{t('source.propertyguru')}</option>
              <option value="hozuko">{t('source.hozuko')}</option>
            </select>
          )}

          {!isStaticSite && (
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-foreground text-background hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRefreshing ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t('header.updating')}
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                  </svg>
                  {t('header.update')}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
