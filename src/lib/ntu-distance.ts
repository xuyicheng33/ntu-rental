import { AreaInfo } from './types';

export const NTU_AREAS: AreaInfo[] = [
  {
    name: 'Jurong West',
    distanceToNtu: '3 km from NTU',
    commuteToNtu: '10–15 min by bus',
    avgRentHdb: '$1,800–2,600/mo (2BR)',
    mrtLine: 'East-West Line (Pioneer MRT)',
    description: 'Closest area to NTU with the most HDB rental options. Direct buses to campus.',
  },
  {
    name: 'Boon Lay',
    distanceToNtu: '3.5 km from NTU',
    commuteToNtu: '15 min by bus',
    avgRentHdb: '$1,800–2,400/mo (2BR)',
    mrtLine: 'East-West Line (Boon Lay MRT)',
    description: 'Mature estate with excellent amenities. Jurong Point mall is a major hub.',
  },
  {
    name: 'Pioneer',
    distanceToNtu: '3.5 km from NTU',
    commuteToNtu: '15 min by bus',
    avgRentHdb: '$1,700–2,300/mo (2BR)',
    mrtLine: 'East-West Line (Pioneer MRT)',
    description: 'Next to Jurong West, similar convenience. Slightly lower rents.',
  },
  {
    name: 'Clementi',
    distanceToNtu: '7 km from NTU',
    commuteToNtu: '20–30 min by bus',
    avgRentHdb: '$2,000–2,600/mo (2BR)',
    mrtLine: 'East-West Line (Clementi MRT)',
    description: 'NUS students also compete for rentals here. Mature estate, convenient but pricier.',
  },
  {
    name: 'Bukit Batok',
    distanceToNtu: '6 km from NTU',
    commuteToNtu: '20–30 min by bus',
    avgRentHdb: '$1,700–2,400/mo (2BR)',
    mrtLine: 'North-South Line (Bukit Batok MRT)',
    description: 'Quiet residential area with good amenities. Direct bus routes to NTU.',
  },
  {
    name: 'Choa Chu Kang',
    distanceToNtu: '8 km from NTU',
    commuteToNtu: '30–40 min by MRT + bus',
    avgRentHdb: '$1,500–2,100/mo (2BR)',
    mrtLine: 'North-South Line (Choa Chu Kang MRT)',
    description: 'More affordable option with LRT connectivity. Longer commute but lower rents.',
  },
  {
    name: 'Bukit Panjang',
    distanceToNtu: '10 km from NTU',
    commuteToNtu: '30–40 min by MRT + bus',
    avgRentHdb: '$1,500–2,000/mo (2BR)',
    mrtLine: 'Downtown Line (Bukit Panjang MRT)',
    description: 'Budget-friendly with LRT network. Good for cost-conscious renters.',
  },
  {
    name: 'Tengah',
    distanceToNtu: '4 km from NTU',
    commuteToNtu: '15–20 min by bus',
    avgRentHdb: '$1,800–2,300/mo (2BR)',
    mrtLine: 'Jurong Region Line (future)',
    description: 'Newest HDB town, modern flats. Limited amenities currently but developing fast.',
  },
];

export function getAreaByName(name: string): AreaInfo | undefined {
  return NTU_AREAS.find(a => a.name === name);
}

export const AREA_NAMES = NTU_AREAS.map(a => a.name);
