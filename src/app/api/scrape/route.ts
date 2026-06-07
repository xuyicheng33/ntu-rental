import { NextRequest } from 'next/server';
import { scrapeListings, getLastUpdated, type ScrapeProgress, type ScraperSource } from '@/lib/scraper';

function parseScraperSource(source: string | null): ScraperSource {
  if (source === 'propertyguru' || source === 'hozuko' || source === 'auto') {
    return source;
  }
  return 'auto';
}

export async function POST(request: NextRequest) {
  const source = parseScraperSource(request.nextUrl.searchParams.get('source'));
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: ScrapeProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      let emittedError = false;

      try {
        await scrapeListings((progress) => {
          if (progress.phase === 'error') emittedError = true;
          send(progress);
        }, source, request.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Scrape failed';
        console.error('Scrape failed:', error);
        if (!emittedError) {
          send({
            phase: 'error',
            currentPage: 0,
            totalPages: 0,
            listingsFound: 0,
            message,
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function GET() {
  const lastUpdated = getLastUpdated();
  return Response.json({ lastUpdated });
}
