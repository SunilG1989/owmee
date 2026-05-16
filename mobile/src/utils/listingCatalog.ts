export type ListingCategoryKind = 'phone' | 'laptop' | 'tablet' | 'appliance' | 'kids' | 'generic';

export const CATEGORY_PICKS = [
  { slug: 'smartphones', label: 'Smartphone' },
  { slug: 'laptops', label: 'Laptop' },
  { slug: 'tablets', label: 'Tablet' },
  { slug: 'small-appliances', label: 'Appliance' },
  { slug: 'kids-toys', label: 'Kids toys' },
  { slug: 'kids-education', label: 'Kids learning' },
  { slug: 'kids-utility', label: 'Kids utility' },
] as const;

export const STORAGE_OPTIONS = ['16GB', '32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB', 'Other'];
export const RAM_OPTIONS = ['2GB', '3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB', '32GB', '64GB', 'Other'];
export const COLOR_OPTIONS = [
  'Black', 'White', 'Silver', 'Grey', 'Gold', 'Blue', 'Green', 'Red',
  'Purple', 'Pink', 'Cream', 'Graphite', 'Midnight', 'Starlight', 'Other',
];
export const SCREEN_SIZE_OPTIONS = [
  '6.1"', '6.5"', '6.7"', '7"', '8"', '10.9"', '11"', '12.9"',
  '13"', '14"', '15.6"', '16"', '17"', 'Other',
];
export const PROCESSOR_OPTIONS = [
  'Apple M1', 'Apple M2', 'Apple M3', 'Apple M4',
  'Intel Core i3', 'Intel Core i5', 'Intel Core i7', 'Intel Core i9',
  'AMD Ryzen 3', 'AMD Ryzen 5', 'AMD Ryzen 7', 'AMD Ryzen 9',
  'Snapdragon X Elite', 'Snapdragon 8 series', 'MediaTek Dimensity', 'Other',
];

const PHONE_BRANDS = [
  'Apple', 'Samsung', 'OnePlus', 'Xiaomi', 'Redmi', 'POCO', 'Vivo', 'iQOO',
  'Oppo', 'Realme', 'Motorola', 'Google', 'Nothing', 'Nokia', 'Honor',
  'Infinix', 'Tecno', 'Lava', 'Asus', 'Sony', 'Huawei', 'Lenovo', 'Micromax',
  'Itel', 'Other',
];

const LAPTOP_TABLET_BRANDS = [
  'Apple', 'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Microsoft',
  'Samsung', 'LG', 'Xiaomi', 'OnePlus', 'Huawei', 'Honor', 'Infinix',
  'Realme', 'Avita', 'Vaio', 'Framework', 'Razer', 'Gigabyte', 'Other',
];

const APPLIANCE_BRANDS = [
  'LG', 'Samsung', 'Whirlpool', 'Bosch', 'IFB', 'Godrej', 'Haier',
  'Panasonic', 'Philips', 'Bajaj', 'Havells', 'Prestige', 'Dyson',
  'Eureka Forbes', 'Kent', 'Voltas', 'Blue Star', 'Carrier', 'Daikin',
  'Lloyd', 'Crompton', 'Usha', 'Orient', 'Morphy Richards', 'Butterfly',
  'Pigeon', 'Wonderchef', 'Faber', 'Kaff', 'Hindware', 'Xiaomi', 'Other',
];

const KIDS_BRANDS = [
  'LEGO', 'Fisher-Price', 'Hot Wheels', 'Barbie', 'Disney', 'Hamleys',
  'Chicco', 'Mee Mee', 'LuvLap', 'R for Rabbit', 'Graco', 'Babyhug',
  'StarAndDaisy', 'Philips Avent', "Dr. Brown's", 'Medela', 'VTech',
  'LeapFrog', 'Funskool', 'Skillmatics', 'Shumee', 'FirstCry', 'Decathlon',
  'Other',
];

const PHONE_MODELS: Record<string, string[]> = {
  Apple: [
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13', 'iPhone 12',
    'iPhone 11', 'iPhone SE',
  ],
  Samsung: [
    'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25', 'Galaxy S24 Ultra',
    'Galaxy S24+', 'Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy S23 FE',
    'Galaxy Z Fold6', 'Galaxy Z Flip6', 'Galaxy A56 5G', 'Galaxy A55 5G',
    'Galaxy A35 5G', 'Galaxy M35 5G', 'Galaxy F55 5G',
  ],
  OnePlus: [
    'OnePlus 13', 'OnePlus 13R', 'OnePlus 12', 'OnePlus 12R',
    'OnePlus 11', 'OnePlus 11R', 'OnePlus Nord 4', 'OnePlus Nord CE4',
    'OnePlus Nord CE4 Lite',
  ],
  Xiaomi: [
    'Xiaomi 14', 'Xiaomi 14 Civi', 'Xiaomi 13 Pro', 'Xiaomi 13',
    'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 13 Pro+',
    'Redmi Note 13 Pro', 'Redmi 13 5G',
  ],
  Redmi: [
    'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 14',
    'Redmi Note 13 Pro+', 'Redmi Note 13 Pro', 'Redmi Note 13',
    'Redmi 13 5G', 'Redmi 12 5G',
  ],
  POCO: ['POCO F6', 'POCO X6 Pro', 'POCO X6', 'POCO M6 Pro', 'POCO C65'],
  Vivo: ['Vivo V40 Pro', 'Vivo V40', 'Vivo V30 Pro', 'Vivo V30', 'Vivo T3 Pro', 'Vivo T3', 'Vivo Y200'],
  iQOO: ['iQOO 13', 'iQOO 12', 'iQOO Neo 9 Pro', 'iQOO Z9s Pro', 'iQOO Z9', 'iQOO Z7 Pro'],
  Oppo: ['Oppo Reno 13 Pro', 'Oppo Reno 13', 'Oppo Reno 12 Pro', 'Oppo Reno 12', 'Oppo F27 Pro+', 'Oppo A3 Pro'],
  Realme: ['Realme GT 6', 'Realme GT 6T', 'Realme 13 Pro+', 'Realme 13 Pro', 'Realme Narzo 70 Pro', 'Realme P1 Pro'],
  Motorola: ['Motorola Edge 50 Ultra', 'Motorola Edge 50 Pro', 'Motorola Edge 50 Fusion', 'Moto G85', 'Moto G64', 'Moto Razr 50'],
  Google: ['Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 8 Pro', 'Pixel 8', 'Pixel 8a', 'Pixel 7a'],
  Nothing: ['Phone (2a) Plus', 'Phone (2a)', 'Phone (2)', 'Phone (1)', 'CMF Phone 1'],
};

const LAPTOP_TABLET_MODELS: Record<string, string[]> = {
  Apple: [
    'MacBook Air M4', 'MacBook Air M3', 'MacBook Air M2', 'MacBook Air M1',
    'MacBook Pro 14-inch', 'MacBook Pro 16-inch', 'iPad Pro M4',
    'iPad Air M2', 'iPad 10th generation', 'iPad mini',
  ],
  HP: ['Pavilion', 'Envy', 'Spectre', 'Victus', 'Omen', 'EliteBook', 'ProBook'],
  Dell: ['Inspiron', 'XPS', 'Latitude', 'Vostro', 'Alienware', 'G15'],
  Lenovo: ['IdeaPad', 'ThinkPad', 'Yoga', 'Legion', 'LOQ', 'Tab P12', 'Tab M11'],
  Asus: ['Vivobook', 'Zenbook', 'TUF Gaming', 'ROG Strix', 'ROG Zephyrus', 'ExpertBook'],
  Acer: ['Aspire', 'Swift', 'Nitro', 'Predator', 'TravelMate'],
  MSI: ['Modern', 'Katana', 'Cyborg', 'Stealth', 'Raider'],
  Microsoft: ['Surface Pro', 'Surface Laptop', 'Surface Laptop Go', 'Surface Go'],
  Samsung: ['Galaxy Tab S10 Ultra', 'Galaxy Tab S9 FE', 'Galaxy Tab A9', 'Galaxy Book', 'Galaxy Book Pro'],
  Xiaomi: ['Xiaomi Pad 7', 'Xiaomi Pad 6', 'Redmi Pad Pro', 'Mi Notebook'],
  OnePlus: ['OnePlus Pad 2', 'OnePlus Pad', 'OnePlus Pad Go'],
};

const APPLIANCE_TYPES = [
  'Air conditioner', 'Air purifier', 'Mixer grinder', 'Microwave oven',
  'Washing machine', 'Refrigerator', 'Water purifier', 'Vacuum cleaner',
  'Geyser', 'Induction cooktop', 'Air fryer', 'Coffee maker', 'Iron',
  'Fan', 'Toaster', 'Food processor', 'Chimney', 'Dishwasher', 'Other',
];

const KIDS_ITEM_TYPES = [
  'Stroller', 'Car seat', 'High chair', 'Baby carrier', 'Crib', 'Walker',
  'Ride-on toy', 'LEGO set', 'Board game', 'STEM kit', 'Learning tablet',
  'School bag', 'Baby monitor', 'Sterilizer', 'Toy kitchen', 'Other',
];

export function getCategoryKind(slug?: string | null): ListingCategoryKind {
  if (slug === 'smartphones') return 'phone';
  if (slug === 'laptops') return 'laptop';
  if (slug === 'tablets') return 'tablet';
  if (slug === 'small-appliances') return 'appliance';
  if (slug?.startsWith('kids-')) return 'kids';
  if (slug === 'kids-utility') return 'kids';
  return 'generic';
}

export function getBrandsForCategory(slug?: string | null): string[] {
  const kind = getCategoryKind(slug);
  if (kind === 'phone') return PHONE_BRANDS;
  if (kind === 'laptop' || kind === 'tablet') return LAPTOP_TABLET_BRANDS;
  if (kind === 'appliance') return APPLIANCE_BRANDS;
  if (kind === 'kids') return KIDS_BRANDS;
  return [...PHONE_BRANDS.slice(0, 12), ...APPLIANCE_BRANDS.slice(0, 8), 'Other'];
}

export function getModelSuggestions(slug?: string | null, brand?: string | null): string[] {
  const kind = getCategoryKind(slug);
  const key = (brand || '').trim();
  if (kind === 'phone') return PHONE_MODELS[key] || [];
  if (kind === 'laptop' || kind === 'tablet') return LAPTOP_TABLET_MODELS[key] || [];
  if (kind === 'appliance') return APPLIANCE_TYPES;
  if (kind === 'kids') return KIDS_ITEM_TYPES;
  return [];
}

export function normalizeListingText(value?: string | null): string | undefined {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : undefined;
}
