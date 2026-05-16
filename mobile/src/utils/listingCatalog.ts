export type ListingCategoryKind = 'phone' | 'laptop' | 'tablet' | 'appliance' | 'kids' | 'other' | 'generic';

export const CATEGORY_PICKS = [
  { slug: 'smartphones', label: 'Smartphone' },
  { slug: 'laptops', label: 'Laptop' },
  { slug: 'tablets', label: 'Tablet' },
  { slug: 'small-appliances', label: 'Appliance' },
  { slug: 'kids-utility', label: 'Kids utility' },
  { slug: 'others', label: 'Other' },
] as const;

export type ListingCategorySlug = typeof CATEGORY_PICKS[number]['slug'];

const CATEGORY_ALIASES: Record<string, ListingCategorySlug> = {
  smartphone: 'smartphones',
  smartphones: 'smartphones',
  phone: 'smartphones',
  phones: 'smartphones',
  mobile: 'smartphones',
  mobiles: 'smartphones',
  mobilephone: 'smartphones',
  mobilephones: 'smartphones',
  cellphone: 'smartphones',
  cellphones: 'smartphones',
  handset: 'smartphones',
  iphone: 'smartphones',
  android: 'smartphones',
  androidphone: 'smartphones',

  laptop: 'laptops',
  laptops: 'laptops',
  notebook: 'laptops',
  notebooks: 'laptops',
  macbook: 'laptops',
  computer: 'laptops',
  computers: 'laptops',
  ultrabook: 'laptops',
  pc: 'laptops',

  tablet: 'tablets',
  tablets: 'tablets',
  ipad: 'tablets',
  ipads: 'tablets',
  tab: 'tablets',
  tabs: 'tablets',

  appliance: 'small-appliances',
  appliances: 'small-appliances',
  smallappliance: 'small-appliances',
  smallappliances: 'small-appliances',
  homeappliance: 'small-appliances',
  homeappliances: 'small-appliances',

  kid: 'kids-utility',
  kids: 'kids-utility',
  child: 'kids-utility',
  children: 'kids-utility',
  toy: 'kids-utility',
  toys: 'kids-utility',
  kidstoys: 'kids-utility',
  kidseducation: 'kids-utility',
  kidslearning: 'kids-utility',
  kidsutility: 'kids-utility',
  baby: 'kids-utility',

  other: 'others',
  others: 'others',
  miscellaneous: 'others',
  misc: 'others',
  general: 'others',
  accessories: 'others',
  accessory: 'others',
  electronics: 'others',
  camera: 'others',
  cameras: 'others',
  headphone: 'others',
  headphones: 'others',
  speaker: 'others',
  speakers: 'others',
  furniture: 'others',
  books: 'others',
  book: 'others',
  fashion: 'others',
  clothes: 'others',
  clothing: 'others',
  shoes: 'others',
  sports: 'others',
};

export const PHONE_STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', 'Other'];
export const LAPTOP_STORAGE_OPTIONS = ['128GB', '256GB', '512GB', '1TB', '2TB', '4TB', '8TB', 'Other'];
export const TABLET_STORAGE_OPTIONS = ['32GB', '64GB', '128GB', '256GB', '512GB', '1TB', '2TB', 'Other'];
export const STORAGE_OPTIONS = Array.from(new Set([
  ...PHONE_STORAGE_OPTIONS,
  ...LAPTOP_STORAGE_OPTIONS,
  ...TABLET_STORAGE_OPTIONS,
]));

export const PHONE_RAM_OPTIONS = ['3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '18GB', '24GB', 'Other'];
export const LAPTOP_RAM_OPTIONS = ['4GB', '8GB', '16GB', '18GB', '24GB', '32GB', '36GB', '48GB', '64GB', '96GB', '128GB', 'Other'];
export const TABLET_RAM_OPTIONS = ['3GB', '4GB', '6GB', '8GB', '12GB', '16GB', '24GB', 'Other'];
export const RAM_OPTIONS = Array.from(new Set([
  ...PHONE_RAM_OPTIONS,
  ...LAPTOP_RAM_OPTIONS,
  ...TABLET_RAM_OPTIONS,
]));
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

const LAPTOP_BRANDS = [
  'Apple', 'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Microsoft',
  'Samsung', 'LG', 'Xiaomi', 'Huawei', 'Honor', 'Infinix', 'Realme',
  'Avita', 'Vaio', 'Framework', 'Razer', 'Gigabyte', 'Other',
];

const TABLET_BRANDS = [
  'Apple', 'Samsung', 'Lenovo', 'Xiaomi', 'OnePlus', 'Realme', 'Oppo',
  'Vivo', 'Honor', 'Huawei', 'Microsoft', 'Other',
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

const OTHER_BRANDS = [
  'Apple', 'Samsung', 'Sony', 'Canon', 'Nikon', 'JBL', 'boAt', 'Noise',
  'Philips', 'IKEA', 'Decathlon', 'Nike', 'Adidas', 'Puma', 'Amazon',
  'Google', 'Mi', 'Lenovo', 'Other',
];

const PHONE_MODELS: Record<string, string[]> = {
  Apple: [
    'iPhone 16 Pro Max', 'iPhone 16 Pro', 'iPhone 16 Plus', 'iPhone 16', 'iPhone 16e',
    'iPhone 15 Pro Max', 'iPhone 15 Pro', 'iPhone 15 Plus', 'iPhone 15',
    'iPhone 14 Pro Max', 'iPhone 14 Pro', 'iPhone 14 Plus', 'iPhone 14',
    'iPhone 13 Pro Max', 'iPhone 13 Pro', 'iPhone 13 mini', 'iPhone 13',
    'iPhone 12 Pro Max', 'iPhone 12 Pro', 'iPhone 12 mini', 'iPhone 12',
    'iPhone 11 Pro Max', 'iPhone 11 Pro', 'iPhone 11', 'iPhone SE', 'Other / not sure',
  ],
  Samsung: [
    'Galaxy S25 Ultra', 'Galaxy S25+', 'Galaxy S25', 'Galaxy S24 Ultra',
    'Galaxy S24+', 'Galaxy S24', 'Galaxy S23 Ultra', 'Galaxy S23 FE',
    'Galaxy Z Fold6', 'Galaxy Z Flip6', 'Galaxy A56 5G', 'Galaxy A55 5G',
    'Galaxy A35 5G', 'Galaxy M35 5G', 'Galaxy F55 5G', 'Other / not sure',
  ],
  OnePlus: [
    'OnePlus 13', 'OnePlus 13R', 'OnePlus 12', 'OnePlus 12R',
    'OnePlus 11', 'OnePlus 11R', 'OnePlus Nord 4', 'OnePlus Nord CE4',
    'OnePlus Nord CE4 Lite', 'Other / not sure',
  ],
  Xiaomi: [
    'Xiaomi 14', 'Xiaomi 14 Civi', 'Xiaomi 13 Pro', 'Xiaomi 13',
    'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 13 Pro+',
    'Redmi Note 13 Pro', 'Redmi 13 5G', 'Other / not sure',
  ],
  Redmi: [
    'Redmi Note 14 Pro+', 'Redmi Note 14 Pro', 'Redmi Note 14',
    'Redmi Note 13 Pro+', 'Redmi Note 13 Pro', 'Redmi Note 13',
    'Redmi 13 5G', 'Redmi 12 5G',
  ],
  POCO: ['POCO F6', 'POCO X6 Pro', 'POCO X6', 'POCO M6 Pro', 'POCO C65', 'Other / not sure'],
  Vivo: ['Vivo V40 Pro', 'Vivo V40', 'Vivo V30 Pro', 'Vivo V30', 'Vivo T3 Pro', 'Vivo T3', 'Vivo Y200'],
  iQOO: ['iQOO 13', 'iQOO 12', 'iQOO Neo 9 Pro', 'iQOO Z9s Pro', 'iQOO Z9', 'iQOO Z7 Pro'],
  Oppo: ['Oppo Reno 13 Pro', 'Oppo Reno 13', 'Oppo Reno 12 Pro', 'Oppo Reno 12', 'Oppo F27 Pro+', 'Oppo A3 Pro'],
  Realme: ['Realme GT 6', 'Realme GT 6T', 'Realme 13 Pro+', 'Realme 13 Pro', 'Realme Narzo 70 Pro', 'Realme P1 Pro'],
  Motorola: ['Motorola Edge 50 Ultra', 'Motorola Edge 50 Pro', 'Motorola Edge 50 Fusion', 'Moto G85', 'Moto G64', 'Moto Razr 50'],
  Google: ['Pixel 9 Pro XL', 'Pixel 9 Pro', 'Pixel 9', 'Pixel 8 Pro', 'Pixel 8', 'Pixel 8a', 'Pixel 7a'],
  Nothing: ['Phone (2a) Plus', 'Phone (2a)', 'Phone (2)', 'Phone (1)', 'CMF Phone 1'],
};

const LAPTOP_MODELS: Record<string, string[]> = {
  Apple: [
    'MacBook Air 13-inch M4', 'MacBook Air 15-inch M4',
    'MacBook Air 13-inch M3', 'MacBook Air 15-inch M3',
    'MacBook Air M2', 'MacBook Air M1',
    'MacBook Pro 14-inch M4', 'MacBook Pro 14-inch M4 Pro', 'MacBook Pro 14-inch M4 Max',
    'MacBook Pro 16-inch M4 Pro', 'MacBook Pro 16-inch M4 Max',
    'MacBook Pro 14-inch M3', 'MacBook Pro 16-inch M3',
    'MacBook Pro 13-inch M2', 'Other / not sure',
  ],
  HP: ['Pavilion', 'Envy', 'Spectre', 'Victus', 'Omen', 'EliteBook', 'ProBook', 'Other / not sure'],
  Dell: ['Inspiron', 'XPS', 'Latitude', 'Vostro', 'Alienware', 'G15', 'Other / not sure'],
  Lenovo: ['IdeaPad', 'ThinkPad', 'Yoga', 'Legion', 'LOQ', 'Other / not sure'],
  Asus: ['Vivobook', 'Zenbook', 'TUF Gaming', 'ROG Strix', 'ROG Zephyrus', 'ExpertBook', 'Other / not sure'],
  Acer: ['Aspire', 'Swift', 'Nitro', 'Predator', 'TravelMate', 'Other / not sure'],
  MSI: ['Modern', 'Katana', 'Cyborg', 'Stealth', 'Raider', 'Other / not sure'],
  Microsoft: ['Surface Pro', 'Surface Laptop', 'Surface Laptop Go', 'Surface Go', 'Other / not sure'],
  Samsung: ['Galaxy Book', 'Galaxy Book Pro', 'Galaxy Book Ultra', 'Other / not sure'],
  Xiaomi: ['Mi Notebook', 'RedmiBook', 'Other / not sure'],
};

const TABLET_MODELS: Record<string, string[]> = {
  Apple: [
    'iPad Pro 11-inch M4', 'iPad Pro 13-inch M4',
    'iPad Air 11-inch M2', 'iPad Air 13-inch M2',
    'iPad 10th generation', 'iPad mini', 'Other / not sure',
  ],
  Samsung: ['Galaxy Tab S10 Ultra', 'Galaxy Tab S10+', 'Galaxy Tab S9 FE', 'Galaxy Tab A9', 'Galaxy Tab A9+', 'Other / not sure'],
  Lenovo: ['Tab P12', 'Tab P11', 'Tab M11', 'Tab M10', 'Other / not sure'],
  Xiaomi: ['Xiaomi Pad 7', 'Xiaomi Pad 6', 'Redmi Pad Pro', 'Redmi Pad SE', 'Other / not sure'],
  OnePlus: ['OnePlus Pad 2', 'OnePlus Pad', 'OnePlus Pad Go', 'Other / not sure'],
  Microsoft: ['Surface Pro', 'Surface Go', 'Other / not sure'],
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

const OTHER_ITEM_TYPES = [
  'Headphones', 'Speaker', 'Camera', 'Watch', 'Monitor', 'Keyboard',
  'Furniture', 'Book', 'Sports item', 'Fashion item', 'Accessory',
  'Home item', 'Other / not sure',
];

export function getCategoryKind(slug?: string | null): ListingCategoryKind {
  const canonical = canonicalCategorySlug(slug);
  if (canonical === 'smartphones') return 'phone';
  if (canonical === 'laptops') return 'laptop';
  if (canonical === 'tablets') return 'tablet';
  if (canonical === 'small-appliances') return 'appliance';
  if (canonical === 'kids-utility') return 'kids';
  if (canonical === 'others') return 'other';
  return 'generic';
}

export function getBrandsForCategory(slug?: string | null): string[] {
  const kind = getCategoryKind(slug);
  if (kind === 'phone') return PHONE_BRANDS;
  if (kind === 'laptop') return LAPTOP_BRANDS;
  if (kind === 'tablet') return TABLET_BRANDS;
  if (kind === 'appliance') return APPLIANCE_BRANDS;
  if (kind === 'kids') return KIDS_BRANDS;
  if (kind === 'other') return OTHER_BRANDS;
  return [...PHONE_BRANDS.slice(0, 12), ...APPLIANCE_BRANDS.slice(0, 8), 'Other'];
}

export function getModelSuggestions(slug?: string | null, brand?: string | null): string[] {
  const kind = getCategoryKind(slug);
  const key = (brand || '').trim();
  if (kind === 'phone') return PHONE_MODELS[key] || [];
  if (kind === 'laptop') return LAPTOP_MODELS[key] || [];
  if (kind === 'tablet') return TABLET_MODELS[key] || [];
  if (kind === 'appliance') return APPLIANCE_TYPES;
  if (kind === 'kids') return KIDS_ITEM_TYPES;
  if (kind === 'other') return OTHER_ITEM_TYPES;
  return [];
}

export function canonicalCategorySlug(slug?: string | null): ListingCategorySlug | '' {
  const token = (slug || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '');
  if (!token) return 'others';
  if (CATEGORY_ALIASES[token]) return CATEGORY_ALIASES[token];
  const direct = CATEGORY_PICKS.find((c) => c.slug.replace(/[^a-z0-9]+/g, '') === token);
  return direct?.slug || 'others';
}

export function getCategoryLabel(slug?: string | null): string {
  const canonical = canonicalCategorySlug(slug);
  return CATEGORY_PICKS.find((c) => c.slug === canonical)?.label || 'Category';
}

export function isElectronicsCategory(slug?: string | null): boolean {
  const kind = getCategoryKind(slug);
  return kind === 'phone' || kind === 'laptop' || kind === 'tablet';
}

export function getStorageOptionsForCategory(slug?: string | null): string[] {
  const kind = getCategoryKind(slug);
  if (kind === 'laptop') return LAPTOP_STORAGE_OPTIONS;
  if (kind === 'tablet') return TABLET_STORAGE_OPTIONS;
  if (kind === 'phone') return PHONE_STORAGE_OPTIONS;
  return STORAGE_OPTIONS;
}

export function getRamOptionsForCategory(slug?: string | null): string[] {
  const kind = getCategoryKind(slug);
  if (kind === 'laptop') return LAPTOP_RAM_OPTIONS;
  if (kind === 'tablet') return TABLET_RAM_OPTIONS;
  if (kind === 'phone') return PHONE_RAM_OPTIONS;
  return RAM_OPTIONS;
}

export function catalogKey(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function findCatalogOption(value?: string | null, options: string[] = []): string {
  const cleaned = (value || '').trim();
  if (!cleaned) return '';

  const compact = catalogKey(cleaned);
  const exact = options.find((option) => catalogKey(option) === compact);
  if (exact) return exact;

  const specMatch = cleaned.toLowerCase().match(/(\d+(?:\.\d+)?)\s*(gb|tb)/);
  if (specMatch) {
    const candidate = `${specMatch[1].replace(/\.0$/, '')}${specMatch[2].toUpperCase()}`;
    return options.find((option) => catalogKey(option) === catalogKey(candidate)) || '';
  }

  return '';
}

export function isKnownCatalogOption(value?: string | null, options: string[] = []): boolean {
  return Boolean(findCatalogOption(value, options));
}

export function normalizeListingText(value?: string | null): string | undefined {
  const cleaned = (value || '').replace(/\s+/g, ' ').trim();
  return cleaned.length ? cleaned : undefined;
}
