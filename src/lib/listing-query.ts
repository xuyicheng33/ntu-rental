import type { FilterState, Listing } from './types';

export interface ListingDataPayload {
  lastUpdated?: string;
  count?: number;
  listings?: Listing[];
}

function getSortableTime(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function filterAndSortListings(
  sourceListings: Listing[],
  filters: FilterState,
): Listing[] {
  let listings = [...sourceListings];

  if (filters.minPrice > 0) {
    listings = listings.filter(listing => listing.price >= filters.minPrice);
  }

  if (filters.maxPrice < 5000) {
    listings = listings.filter(listing => listing.price <= filters.maxPrice);
  }

  if (filters.bedrooms.length > 0) {
    listings = listings.filter(listing => filters.bedrooms.includes(listing.bedrooms));
  }

  if (filters.bathrooms.length > 0) {
    listings = listings.filter(listing => filters.bathrooms.includes(listing.bathrooms));
  }

  if (filters.areas.length > 0) {
    listings = listings.filter(listing => filters.areas.includes(listing.area));
  }

  if (filters.propertyTypes.length > 0) {
    listings = listings.filter(listing => filters.propertyTypes.includes(listing.propertyType));
  }

  switch (filters.sortBy) {
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

  return listings;
}

export function filtersFromSearchParams(searchParams: URLSearchParams): FilterState {
  const parseNumberList = (key: string) => {
    const value = searchParams.get(key);
    return value ? value.split(',').map(Number).filter(Number.isFinite) : [];
  };

  return {
    minPrice: Number(searchParams.get('minPrice') || 0),
    maxPrice: Number(searchParams.get('maxPrice') || 5000),
    bedrooms: parseNumberList('bedrooms'),
    bathrooms: parseNumberList('bathrooms'),
    areas: searchParams.get('areas')?.split(',').filter(Boolean) || [],
    propertyTypes: searchParams.get('propertyTypes')?.split(',').filter(Boolean) || [],
    sortBy: (searchParams.get('sortBy') || 'newest') as FilterState['sortBy'],
  };
}
