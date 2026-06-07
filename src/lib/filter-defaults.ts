import type { FilterState } from './types';

export const DEFAULT_FILTERS: FilterState = {
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: [],
  bathrooms: [],
  areas: [],
  propertyTypes: [],
  sortBy: 'newest',
};
