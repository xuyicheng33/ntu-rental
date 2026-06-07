import { NextRequest } from 'next/server';
import { readListings, getLastUpdated } from '@/lib/scraper';
import { SAMPLE_LISTINGS } from '@/lib/sample-data';

function getSortableTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  let listings = readListings();
  let isSampleData = false;

  // Fall back to sample data if no scraped data exists
  if (listings.length === 0) {
    listings = SAMPLE_LISTINGS;
    isSampleData = true;
  }

  listings = [...listings];

  // Apply filters
  const minPrice = searchParams.get('minPrice');
  const maxPrice = searchParams.get('maxPrice');
  const bedrooms = searchParams.get('bedrooms');
  const bathrooms = searchParams.get('bathrooms');
  const areas = searchParams.get('areas');
  const propertyTypes = searchParams.get('propertyTypes');
  const sortBy = searchParams.get('sortBy') || 'newest';

  if (minPrice) {
    const price = parseInt(minPrice, 10);
    if (Number.isFinite(price)) listings = listings.filter(l => l.price >= price);
  }
  if (maxPrice) {
    const price = parseInt(maxPrice, 10);
    if (Number.isFinite(price)) listings = listings.filter(l => l.price <= price);
  }
  if (bedrooms) {
    const beds = bedrooms.split(',').map(Number).filter(Number.isFinite);
    listings = listings.filter(l => beds.includes(l.bedrooms));
  }
  if (bathrooms) {
    const baths = bathrooms.split(',').map(Number).filter(Number.isFinite);
    listings = listings.filter(l => baths.includes(l.bathrooms));
  }
  if (areas) {
    const areaList = areas.split(',');
    listings = listings.filter(l => areaList.includes(l.area));
  }
  if (propertyTypes) {
    const types = propertyTypes.split(',');
    listings = listings.filter(l => types.includes(l.propertyType));
  }

  // Sort
  switch (sortBy) {
    case 'price-asc':
      listings.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      listings.sort((a, b) => b.price - a.price);
      break;
    case 'newest':
      listings.sort((a, b) => getSortableTime(b.postedDate) - getSortableTime(a.postedDate));
      break;
    case 'size-desc':
      listings.sort((a, b) => b.floorSize - a.floorSize);
      break;
  }

  const lastUpdated = getLastUpdated();

  return Response.json({
    listings,
    total: listings.length,
    lastUpdated,
    isSampleData,
  });
}
