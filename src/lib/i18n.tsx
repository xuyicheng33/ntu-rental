'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type Lang = 'en' | 'zh';

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const translations: Record<Lang, Record<string, string>> = {
  en: {
    // Header
    'app.title': 'NTU Rental Finder',
    'app.subtitle': 'Rental properties near Nanyang Technological University',
    'header.updated': 'Updated',
    'header.update': 'Update Data',
    'header.updating': 'Updating...',
    'header.source': 'Listing source',
    'source.auto': 'PropertyGuru first',
    'source.propertyguru': 'PropertyGuru',
    'source.hozuko': 'Hozuko',

    // Hero
    'hero.title': 'Find your home near NTU',
    'hero.desc': 'PropertyGuru is the default source, with other real listing sites available as fallbacks. Browse rentals in Jurong West, Boon Lay, Clementi, and other NTU-adjacent areas.',
    'data.sampleWarning': 'Showing sample listings because no live scrape data is available yet.',

    // Stats
    'stats.properties': 'Properties',
    'stats.avgPrice': 'Avg Price',
    'stats.median': 'Median',
    'stats.range': 'Range',

    // Filters
    'filter.title': 'Filters',
    'filter.found': 'properties found',
    'filter.clearAll': 'Clear all filters',
    'filter.priceRange': 'Price Range (SGD/month)',
    'filter.bedrooms': 'Bedrooms',
    'filter.bathrooms': 'Bathrooms',
    'filter.propertyType': 'Property Type',
    'filter.area': 'Area',
    'filter.sortBy': 'Sort By',
    'filter.room': 'Room',
    'filter.rooms': 'Rooms',
    'filter.bath': 'Bath',
    'filter.baths': 'Baths',
    'filter.min': 'Min',
    'filter.max': 'Max',

    // Sort options
    'sort.newest': 'Newest First',
    'sort.priceAsc': 'Price: Low to High',
    'sort.priceDesc': 'Price: High to Low',
    'sort.sizeDesc': 'Largest First',

    // Listing
    'listing.month': '/month',
    'listing.viewOn': 'View on',

    // Empty state
    'empty.title': 'No properties found',
    'empty.desc': 'Try adjusting your filters or updating the data',

    // Progress
    'progress.title': 'Updating Property Data',
    'progress.starting': 'Starting scraper...',
    'progress.opening': 'Opening page',
    'progress.parsing': 'Parsing listings...',
    'progress.done': 'Update complete!',
    'progress.failed': 'Update failed',
    'progress.found': 'found',
    'progress.listings': 'listings',
    'progress.page': 'Page',
    'progress.of': 'of',
    'progress.cancel': 'Cancel',
    'progress.close': 'Close',
    'propertyguru.openSession': 'Open PropertyGuru verification',
    'propertyguru.sessionOpening': 'Opening...',
    'propertyguru.sessionStarted': 'PropertyGuru verification opened in your default browser. Finish Cloudflare there, then update again.',
    'propertyguru.sessionSaved': 'PropertyGuru verification saved. Update again with PropertyGuru.',
    'propertyguru.sessionFailed': 'Failed to open PropertyGuru verification',

    // Footer
    'footer.disclaimer': 'PropertyGuru is tried first; if blocked, the app falls back to other real listing sources. For reference only — always verify details on the original listing.',

    // Language
    'lang.en': 'EN',
    'lang.zh': '中文',
  },
  zh: {
    // Header
    'app.title': 'NTU 租房搜索',
    'app.subtitle': '南洋理工大学周边租房信息',
    'header.updated': '更新于',
    'header.update': '更新数据',
    'header.updating': '更新中...',
    'header.source': '房源来源',
    'source.auto': '默认优先 PropertyGuru',
    'source.propertyguru': 'PropertyGuru',
    'source.hozuko': 'Hozuko',

    // Hero
    'hero.title': '在NTU附近找到你的家',
    'hero.desc': '默认优先使用 PropertyGuru，也可以切换到其他真实房源来源。浏览南洋理工大学附近裕廊西、文礼、金文泰等区域的租房信息。',
    'data.sampleWarning': '当前显示示例房源，因为还没有可用的实时抓取数据。',

    // Stats
    'stats.properties': '房源数',
    'stats.avgPrice': '均价',
    'stats.median': '中位数',
    'stats.range': '价格区间',

    // Filters
    'filter.title': '筛选条件',
    'filter.found': '套房源',
    'filter.clearAll': '清除所有筛选',
    'filter.priceRange': '价格范围（新元/月）',
    'filter.bedrooms': '卧室数',
    'filter.bathrooms': '浴室数',
    'filter.propertyType': '房型',
    'filter.area': '区域',
    'filter.sortBy': '排序方式',
    'filter.room': '房',
    'filter.rooms': '房',
    'filter.bath': '卫',
    'filter.baths': '卫',
    'filter.min': '最低',
    'filter.max': '最高',

    // Sort options
    'sort.newest': '最新优先',
    'sort.priceAsc': '价格从低到高',
    'sort.priceDesc': '价格从高到低',
    'sort.sizeDesc': '面积最大优先',

    // Listing
    'listing.month': '/月',
    'listing.viewOn': '查看来源',

    // Empty state
    'empty.title': '未找到房源',
    'empty.desc': '请调整筛选条件或更新数据',

    // Progress
    'progress.title': '正在更新房源数据',
    'progress.starting': '正在启动爬虫...',
    'progress.opening': '正在打开页面',
    'progress.parsing': '正在解析房源...',
    'progress.done': '更新完成！',
    'progress.failed': '更新失败',
    'progress.found': '已找到',
    'progress.listings': '条房源',
    'progress.page': '第',
    'progress.of': '/ 共',
    'progress.cancel': '取消',
    'progress.close': '关闭',
    'propertyguru.openSession': '打开 PropertyGuru 真人认证',
    'propertyguru.sessionOpening': '正在打开...',
    'propertyguru.sessionStarted': '已在默认浏览器打开 PropertyGuru 认证。请在那里完成 Cloudflare 后再次更新。',
    'propertyguru.sessionSaved': 'PropertyGuru 认证已保存。请再次用 PropertyGuru 更新。',
    'propertyguru.sessionFailed': '打开 PropertyGuru 认证失败',

    // Footer
    'footer.disclaimer': '系统会优先尝试 PropertyGuru；如果被拦截，会自动切换到其他真实房源来源。仅供参考 — 请以原始房源信息为准。',

    // Language
    'lang.en': 'EN',
    'lang.zh': '中文',
  },
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('zh');

  const t = useCallback(
    (key: string) => {
      const value = translations[lang][key];
      if (!value && process.env.NODE_ENV === 'development') {
        console.warn(`[i18n] Missing translation: "${key}" for lang "${lang}"`);
      }
      return value || key;
    },
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
