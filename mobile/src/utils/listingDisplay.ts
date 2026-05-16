import { getCategoryKind, type ListingCategoryKind } from './listingCatalog';

export type ListingDisplayItem = {
  title?: string | null;
  category_slug?: string | null;
  is_kids_item?: boolean | null;
  condition?: string | null;
  brand?: string | null;
  model?: string | null;
  storage?: string | null;
  ram?: string | null;
  color?: string | null;
  processor?: string | null;
  screen_size?: string | null;
  purchase_year?: number | string | null;
  screen_condition?: string | null;
  body_condition?: string | null;
  defects?: string[] | null;
  accessories?: string | null;
  warranty_info?: string | null;
  warranty_status?: string | null;
  battery_health?: number | string | null;
  age_suitability?: string | null;
  hygiene_status?: string | null;
  has_box?: boolean | null;
  has_bill?: boolean | null;
  box_available?: boolean | null;
  bill_available?: boolean | null;
  warranty_active?: boolean | null;
  has_charger?: boolean | null;
  has_earphones?: boolean | null;
  water_damage_history?: boolean | null;
  seller_functional_attestation?: boolean | null;
  kids_safety_checklist?: Record<string, unknown> | null;
};

export type ProductFact = {
  label: string;
  value: string;
};

type ChipOptions = {
  conditionLabel?: string;
  displayTitle?: string | null;
  includeCondition?: boolean;
  max?: number;
};

const MISSING_RX = /^(n\/a|na|none|null|unknown|not sure|other \/ not sure|other)$/i;

export function listingCategoryKind(item: ListingDisplayItem): ListingCategoryKind {
  if (item.is_kids_item) return 'kids';
  return getCategoryKind(item.category_slug);
}

export function cleanListingFact(value: unknown): string | null {
  const cleaned = String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || MISSING_RX.test(cleaned)) return null;
  return cleaned
    .replace(/\bgb\b/gi, 'GB')
    .replace(/\btb\b/gi, 'TB')
    .replace(/\bmah\b/gi, 'mAh');
}

function capacityValue(value: unknown): string | null {
  const text = cleanListingFact(value);
  if (!text) return null;
  return /^\d+$/.test(text) ? `${text}GB` : text;
}

function batteryValue(value: unknown): string | null {
  const text = cleanListingFact(value);
  if (!text) return null;
  return /%$/.test(text) ? text : `${text}%`;
}

function yesNoFact(value: boolean | null | undefined, yes: string, no: string): string | null {
  if (value === true) return yes;
  if (value === false) return no;
  return null;
}

function normalize(value: string | null | undefined): string {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function titleAlreadyHas(title: string | null | undefined, value: string | null): boolean {
  if (!value) return false;
  const needle = normalize(value);
  return needle.length >= 3 && normalize(title).includes(needle);
}

function titleCaseWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (/^[A-Z0-9]+$/.test(word) && word.length <= 5) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function addUnique(list: string[], value: string | null | undefined) {
  if (!value) return;
  const label = value.trim();
  if (!label) return;
  const key = label.toLowerCase();
  if (!list.some((item) => item.toLowerCase() === key)) list.push(label);
}

function identityLabel(item: ListingDisplayItem, title: string | null | undefined): string | null {
  const brand = cleanListingFact(item.brand);
  const model = cleanListingFact(item.model);
  const identity = [brand, model].filter(Boolean).join(' ');
  if (!identity || titleAlreadyHas(title, identity)) return null;
  return titleCaseWords(identity);
}

function safetyChecklistCount(item: ListingDisplayItem): number {
  const checklist = item.kids_safety_checklist;
  if (!checklist || typeof checklist !== 'object') return 0;
  return Object.values(checklist).filter(Boolean).length;
}

function knownIssues(value: string[] | null | undefined): string | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value.map(cleanListingFact).filter(Boolean) as string[];
  return cleaned.length ? cleaned.join(', ') : null;
}

export function buildListingFactChips(item: ListingDisplayItem, options: ChipOptions = {}): string[] {
  const {
    conditionLabel,
    displayTitle = item.title,
    includeCondition = true,
    max = 4,
  } = options;
  const chips: string[] = [];
  const kind = listingCategoryKind(item);
  const model = cleanListingFact(item.model);
  const brand = cleanListingFact(item.brand);
  const warranty = cleanListingFact(item.warranty_status || item.warranty_info);
  const hasBill = item.has_bill ?? item.bill_available;
  const hasBox = item.has_box ?? item.box_available;
  const activeWarranty = item.warranty_active || (warranty && !/no warranty|none|expired/i.test(warranty)) ? 'Warranty' : null;

  if (includeCondition) addUnique(chips, conditionLabel || cleanListingFact(item.condition));

  if (kind === 'phone' || kind === 'tablet') {
    addUnique(chips, identityLabel(item, displayTitle));
    addUnique(chips, capacityValue(item.storage));
    if (kind === 'tablet') addUnique(chips, capacityValue(item.ram));
    addUnique(chips, cleanListingFact(item.color));
    addUnique(chips, batteryValue(item.battery_health) ? `${batteryValue(item.battery_health)} battery` : null);
    addUnique(chips, activeWarranty);
    if (hasBill) addUnique(chips, 'Bill');
    if (hasBox) addUnique(chips, 'Box');
    return chips.slice(0, max);
  }

  if (kind === 'laptop') {
    addUnique(chips, identityLabel(item, displayTitle));
    addUnique(chips, capacityValue(item.ram) ? `${capacityValue(item.ram)} RAM` : null);
    addUnique(chips, capacityValue(item.storage));
    addUnique(chips, cleanListingFact(item.processor));
    addUnique(chips, cleanListingFact(item.screen_size));
    addUnique(chips, activeWarranty);
    if (hasBill) addUnique(chips, 'Bill');
    return chips.slice(0, max);
  }

  if (kind === 'appliance') {
    addUnique(chips, model && !titleAlreadyHas(displayTitle, model) ? titleCaseWords(model) : null);
    addUnique(chips, brand && !titleAlreadyHas(displayTitle, brand) ? brand : null);
    addUnique(chips, activeWarranty);
    if (hasBill) addUnique(chips, 'Bill');
    addUnique(chips, item.purchase_year ? String(item.purchase_year) : null);
    addUnique(chips, yesNoFact(item.seller_functional_attestation, 'Working', 'Needs check'));
    return chips.slice(0, max);
  }

  if (kind === 'kids') {
    addUnique(chips, cleanListingFact(item.age_suitability));
    addUnique(chips, model && !titleAlreadyHas(displayTitle, model) ? titleCaseWords(model) : null);
    addUnique(chips, cleanListingFact(item.hygiene_status));
    addUnique(chips, brand && !titleAlreadyHas(displayTitle, brand) ? brand : null);
    if (safetyChecklistCount(item) > 0) addUnique(chips, 'Safety checked');
    if (hasBox) addUnique(chips, 'Box');
    return chips.slice(0, max);
  }

  addUnique(chips, model && !titleAlreadyHas(displayTitle, model) ? titleCaseWords(model) : null);
  addUnique(chips, brand && !titleAlreadyHas(displayTitle, brand) ? brand : null);
  addUnique(chips, cleanListingFact(item.color));
  addUnique(chips, item.purchase_year ? String(item.purchase_year) : null);
  addUnique(chips, activeWarranty);
  if (hasBill) addUnique(chips, 'Bill');
  return chips.slice(0, max);
}

export function buildListingProductFacts(
  item: ListingDisplayItem,
  conditionLabel?: string,
): ProductFact[] {
  const kind = listingCategoryKind(item);
  const defects = knownIssues(item.defects);
  const warranty = item.warranty_active ? 'Warranty' : cleanListingFact(item.warranty_status || item.warranty_info);
  const hasBill = item.has_bill ?? item.bill_available;
  const hasBox = item.has_box ?? item.box_available;
  const commonTail: Array<[string, string | null]> = [
    ['Colour', cleanListingFact(item.color)],
    ['Purchase year', item.purchase_year ? String(item.purchase_year) : null],
    ['Warranty', warranty],
    ['Bill', yesNoFact(hasBill, 'Available', 'Not available')],
    ['Included items', cleanListingFact(item.accessories)],
    ['Known issues', defects],
  ];

  const rowsByKind: Record<ListingCategoryKind, Array<[string, string | null]>> = {
    phone: [
      ['Brand', cleanListingFact(item.brand)],
      ['Model', cleanListingFact(item.model)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ['Storage', capacityValue(item.storage)],
      ['RAM', capacityValue(item.ram)],
      ['Battery health', batteryValue(item.battery_health)],
      ['Screen condition', cleanListingFact(item.screen_condition)],
      ['Body condition', cleanListingFact(item.body_condition)],
      ['Box', yesNoFact(hasBox, 'Available', 'Not available')],
      ['Charger', yesNoFact(item.has_charger, 'Included', 'Not included')],
      ['Earphones', yesNoFact(item.has_earphones, 'Included', 'Not included')],
      ['Water damage', yesNoFact(item.water_damage_history, 'Reported', 'No history declared')],
      ['Functionality', yesNoFact(item.seller_functional_attestation, 'Seller says fully functional', 'Needs buyer review')],
      ...commonTail,
    ],
    tablet: [
      ['Brand', cleanListingFact(item.brand)],
      ['Model', cleanListingFact(item.model)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ['Storage', capacityValue(item.storage)],
      ['RAM', capacityValue(item.ram)],
      ['Screen size', cleanListingFact(item.screen_size)],
      ['Battery health', batteryValue(item.battery_health)],
      ['Box', yesNoFact(hasBox, 'Available', 'Not available')],
      ['Charger', yesNoFact(item.has_charger, 'Included', 'Not included')],
      ['Functionality', yesNoFact(item.seller_functional_attestation, 'Seller says fully functional', 'Needs buyer review')],
      ...commonTail,
    ],
    laptop: [
      ['Brand', cleanListingFact(item.brand)],
      ['Model', cleanListingFact(item.model)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ['RAM', capacityValue(item.ram)],
      ['Storage', capacityValue(item.storage)],
      ['Processor', cleanListingFact(item.processor)],
      ['Screen size', cleanListingFact(item.screen_size)],
      ['Battery health', batteryValue(item.battery_health)],
      ['Box', yesNoFact(hasBox, 'Available', 'Not available')],
      ['Charger', yesNoFact(item.has_charger, 'Included', 'Not included')],
      ['Water damage', yesNoFact(item.water_damage_history, 'Reported', 'No history declared')],
      ['Functionality', yesNoFact(item.seller_functional_attestation, 'Seller says fully functional', 'Needs buyer review')],
      ...commonTail,
    ],
    appliance: [
      ['Product type', cleanListingFact(item.model)],
      ['Brand', cleanListingFact(item.brand)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ['Functionality', yesNoFact(item.seller_functional_attestation, 'Seller says working', 'Needs buyer review')],
      ['Box / packaging', yesNoFact(hasBox, 'Available', 'Not available')],
      ...commonTail,
    ],
    kids: [
      ['Item type', cleanListingFact(item.model)],
      ['Age suitability', cleanListingFact(item.age_suitability)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ['Cleanliness', cleanListingFact(item.hygiene_status)],
      ['Brand', cleanListingFact(item.brand)],
      ['Safety checks', safetyChecklistCount(item) > 0 ? `${safetyChecklistCount(item)} checked` : null],
      ['Original packaging', yesNoFact(hasBox, 'Available', 'Not available')],
      ...commonTail,
    ],
    other: [
      ['Item type', cleanListingFact(item.model)],
      ['Brand', cleanListingFact(item.brand)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ...commonTail,
    ],
    generic: [
      ['Item type', cleanListingFact(item.model)],
      ['Brand', cleanListingFact(item.brand)],
      ['Condition', conditionLabel || cleanListingFact(item.condition)],
      ...commonTail,
    ],
  };

  const seen = new Set<string>();
  return rowsByKind[kind]
    .filter(([, value]) => !!value)
    .filter(([label]) => {
      if (seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .map(([label, value]) => ({ label, value: value! }));
}
