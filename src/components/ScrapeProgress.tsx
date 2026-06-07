'use client';

import { useI18n } from '@/lib/i18n';
import type { ScrapeProgress as ScrapeProgressType } from '@/lib/scraper';

interface ScrapeProgressProps {
  progress: ScrapeProgressType | null;
  onClose: () => void;
  onStartPropertyGuruSession?: () => Promise<void>;
  isStartingPropertyGuruSession?: boolean;
}

export function ScrapeProgressOverlay({
  progress,
  onClose,
  onStartPropertyGuruSession,
  isStartingPropertyGuruSession = false,
}: ScrapeProgressProps) {
  const { t } = useI18n();
  if (!progress) return null;

  const isDone = progress.phase === 'done';
  const isError = progress.phase === 'error';
  const needsPropertyGuruSession = progress.action === 'propertyguru-session' ||
    (isError && /PropertyGuru|Cloudflare|propertyguru:session/i.test(progress.message));
  const percent = progress.totalPages > 0
    ? Math.round((progress.currentPage / progress.totalPages) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-card rounded-2xl border border-border/50 shadow-2xl p-8 w-full max-w-md mx-4">
        {/* Header */}
        <h3 className="text-lg font-semibold mb-6">{t('progress.title')}</h3>

        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>{t('progress.page')} {progress.currentPage} {t('progress.of')} {progress.totalPages}</span>
            <span>{percent}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isError ? 'bg-destructive' : isDone ? 'bg-green-500' : 'bg-foreground'
              }`}
              style={{ width: `${isDone ? 100 : percent}%` }}
            />
          </div>
        </div>

        {/* Status */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center gap-3">
            {!isDone && !isError && (
              <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isDone && (
              <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            )}
            {isError && (
              <svg className="h-4 w-4 text-destructive" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            )}
            <span className="text-sm">{progress.message}</span>
          </div>

          {progress.listingsFound > 0 && (
            <p className="text-sm text-muted-foreground pl-7">
              {t('progress.found')} {progress.listingsFound} {t('progress.listings')}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-end gap-2">
          {needsPropertyGuruSession && onStartPropertyGuruSession && (
            <button
              onClick={() => void onStartPropertyGuruSession()}
              disabled={isStartingPropertyGuruSession}
              className="px-5 py-2.5 text-sm font-medium rounded-xl border border-border bg-background hover:bg-muted transition-all disabled:opacity-50"
            >
              {isStartingPropertyGuruSession ? t('propertyguru.sessionOpening') : t('propertyguru.openSession')}
            </button>
          )}
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium rounded-xl bg-foreground text-background hover:opacity-90 transition-all"
          >
            {isDone || isError ? t('progress.close') : t('progress.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
