export interface Listing {
  id: string;
  source?: 'PropertyGuru' | 'Hozuko' | 'Listings.sg';
  title: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  floorSize: number;
  address: string;
  area: string;
  propertyType: 'HDB' | 'Condo' | 'Landed' | 'Room';
  url: string;
  imageUrl: string;
  nearestMrt: string;
  postedDate: string;
  agentName: string;
}

export interface AreaInfo {
  name: string;
  distanceToNtu: string;
  commuteToNtu: string;
  avgRentHdb: string;
  mrtLine: string;
  description: string;
}

export interface ScrapeResult {
  success: boolean;
  count: number;
  lastUpdated: string;
  error?: string;
}

export interface FilterState {
  minPrice: number;
  maxPrice: number;
  bedrooms: number[];
  bathrooms: number[];
  areas: string[];
  propertyTypes: string[];
  sortBy: 'price-asc' | 'price-desc' | 'newest' | 'size-desc';
}
