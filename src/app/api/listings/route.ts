import { NextRequest } from 'next/server';
import { readListings, getLastUpdated } from '@/lib/scraper';
import { SAMPLE_LISTINGS } from '@/lib/sample-data';
import { filterAndSortListings, filtersFromSearchParams } from '@/lib/listing-query';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  let listings = readListings();
  let isSampleData = false;

  // Fall back to sample data if no scraped data exists
  if (listings.length === 0) {
    listings = SAMPLE_LISTINGS;
    isSampleData = true;
  }

  listings = filterAndSortListings(listings, filtersFromSearchParams(searchParams));

  const lastUpdated = getLastUpdated();

  return Response.json({
    listings,
    total: listings.length,
    lastUpdated,
    isSampleData,
  });
}
