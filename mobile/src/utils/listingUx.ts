export const TOY_DISCLOSURE_OPTIONS = [
  'Complete and safe',
  'Missing part disclosed',
  'Safety issue disclosed',
];

export const BOOK_CONDITION_OPTIONS = [
  'All pages present',
  'Notes/highlights disclosed',
  'Missing/damaged pages disclosed',
];

export const APPLIANCE_STATUS_OPTIONS = [
  'Working, no known defects',
  'Working with issue disclosed',
  'Not working / for parts',
];

export type SmartReviewRequiredLevel = 'P0' | 'P1';
export type SmartReviewCheckStatus = 'confirmed' | 'missing' | 'not_applicable' | 'not_sure';
export type SmartReviewCheckSource = 'ai' | 'seller' | 'system';

export type SmartReviewCheck = {
  id: string;
  label: string;
  summary: string;
  action: string;
  requiredLevel: SmartReviewRequiredLevel;
  status: SmartReviewCheckStatus;
  source: SmartReviewCheckSource;
  confidence?: number | null;
  buyerVisible: boolean;
  confirmationRequired?: boolean;
};

const readSpecific = (specifics: Record<string, any>, key: string) => {
  const raw = specifics[key];
  if (raw == null) return '';
  return String(raw).replace(/\s+/g, ' ').trim();
};

export const toyDisclosureValue = (specifics: Record<string, any>) => {
  const safety = readSpecific(specifics, 'safety_status').toLowerCase();
  const parts = readSpecific(specifics, 'missing_parts_status').toLowerCase();
  if (!safety || !parts) return '';
  if (safety.includes('issue') || safety.includes('review')) return 'Safety issue disclosed';
  if (parts.includes('missing') || parts.includes('not sure')) return 'Missing part disclosed';
  return 'Complete and safe';
};

export const toyDisclosureSpecifics = (value: string) => {
  const missingParts = value === 'Complete and safe'
    ? 'Complete / no parts missing'
    : value === 'Missing part disclosed'
      ? 'Minor missing parts disclosed'
      : 'Issue disclosed';
  const safetyStatus = value === 'Safety issue disclosed'
    ? 'Issue disclosed'
    : 'No visible safety issue';
  return {
    missing_parts_status: missingParts,
    safety_status: safetyStatus,
  };
};

export const bookConditionValue = (specifics: Record<string, any>) => {
  const pages = readSpecific(specifics, 'pages_complete').toLowerCase();
  const pageCondition = readSpecific(specifics, 'page_condition').toLowerCase();
  const markings = readSpecific(specifics, 'markings_status').toLowerCase();
  if (!pages || !pageCondition || !markings) return '';
  if (
    pages.includes('missing')
    || pages.includes('damaged')
    || pageCondition.includes('tear')
    || pageCondition.includes('water')
  ) return 'Missing/damaged pages disclosed';
  if (markings.includes('note') || markings.includes('highlight') || markings.includes('mark')) {
    return 'Notes/highlights disclosed';
  }
  return 'All pages present';
};

export const bookConditionSpecifics = (value: string, previous: Record<string, any> = {}) => {
  const partial = value === 'Missing/damaged pages disclosed';
  const marked = value === 'Notes/highlights disclosed';
  const next: Record<string, string> = {
    page_condition: partial ? 'Missing or damaged pages disclosed' : marked ? 'Minor wear' : 'Pages clean',
    markings_status: marked || partial ? 'Notes/highlights disclosed' : 'No markings',
    pages_complete: partial ? 'Missing pages disclosed' : 'All pages present',
  };
  const language = readSpecific(previous, 'language');
  if (language) next.language = language;
  return next;
};

export const applianceStatusValue = (specifics: Record<string, any>) => {
  const working = readSpecific(specifics, 'working_status').toLowerCase();
  const defects = readSpecific(specifics, 'defects_disclosed').toLowerCase();
  if (!working || !defects) return '';
  if (working.includes('not working') || defects.includes('not working')) return 'Not working / for parts';
  if (working.includes('partial') || defects.includes('defect') || defects.includes('issue')) {
    return 'Working with issue disclosed';
  }
  return 'Working, no known defects';
};

export const applianceStatusSpecifics = (value: string, previous: Record<string, any> = {}) => {
  const next: Record<string, string> = {
    working_status: value === 'Not working / for parts' ? 'Not working' : value === 'Working with issue disclosed' ? 'Partially working' : 'Fully working',
    defects_disclosed: value === 'Working, no known defects'
      ? 'No known defects'
      : value === 'Working with issue disclosed'
        ? 'Defects disclosed'
        : 'Not working disclosed',
  };
  const accessories = readSpecific(previous, 'accessories_status');
  if (accessories) next.accessories_status = accessories;
  return next;
};

export const disclosureNeedsDetail = (
  family: 'toy' | 'book' | 'appliance' | 'device' | 'other',
  specifics: Record<string, any>,
) => {
  if (family === 'toy') return toyDisclosureValue(specifics) !== '' && toyDisclosureValue(specifics) !== 'Complete and safe';
  if (family === 'book') return bookConditionValue(specifics) !== '' && bookConditionValue(specifics) !== 'All pages present';
  if (family === 'appliance') return applianceStatusValue(specifics) !== '' && applianceStatusValue(specifics) !== 'Working, no known defects';
  return false;
};

export const disclosureDetailPrompt = (
  family: 'toy' | 'book' | 'appliance' | 'device' | 'other',
  specifics: Record<string, any>,
) => {
  if (family === 'toy') {
    return toyDisclosureValue(specifics) === 'Safety issue disclosed'
      ? 'What safety issue should the buyer know?'
      : 'What part is missing or needs buyer attention?';
  }
  if (family === 'book') {
    return bookConditionValue(specifics) === 'Notes/highlights disclosed'
      ? 'Where are the notes or highlights?'
      : 'Which pages are missing or damaged?';
  }
  if (family === 'appliance') return 'What issue should the buyer know before paying?';
  return 'What should the buyer know?';
};

export const appendDisclosureToDescription = (description: string, disclosure: string) => {
  const base = description.trim();
  const note = disclosure.trim();
  if (!note) return base;
  return base ? `${base}\n\nDisclosure: ${note}` : `Disclosure: ${note}`;
};

const compactValue = (value?: string | number | boolean | null) => {
  if (value === true || value === false || typeof value === 'number') return String(value);
  return String(value || '').replace(/\s+/g, ' ').trim();
};

const valueStatus = (value?: string | number | boolean | null, required = true): SmartReviewCheckStatus => {
  const cleaned = compactValue(value);
  if (!required) return cleaned ? 'confirmed' : 'not_applicable';
  if (!cleaned) return 'missing';
  const lower = cleaned.toLowerCase();
  if (lower === 'not sure' || lower.includes('not sure') || lower.includes('not checked')) return 'not_sure';
  return 'confirmed';
};

const check = ({
  id,
  label,
  value,
  summary,
  status,
  action,
  source = 'seller',
  confidence,
  requiredLevel = 'P0',
  required = true,
  buyerVisible = true,
  confirmationRequired,
}: {
  id: string;
  label: string;
  value?: string | number | boolean | null;
  summary?: string;
  status?: SmartReviewCheckStatus;
  action: string;
  source?: SmartReviewCheckSource;
  confidence?: number | null;
  requiredLevel?: SmartReviewRequiredLevel;
  required?: boolean;
  buyerVisible?: boolean;
  confirmationRequired?: boolean;
}): SmartReviewCheck => {
  const resolvedStatus = status ?? valueStatus(value, required);
  return {
    id,
    label,
    summary: summary ?? (compactValue(value) || 'Needs answer'),
    action,
    requiredLevel,
    status: resolvedStatus,
    source,
    confidence,
    buyerVisible,
    confirmationRequired: confirmationRequired ?? (confidence != null && confidence < 0.65 && resolvedStatus === 'confirmed'),
  };
};

export function buildSmartReviewChecks({
  photoCount,
  minPhotos,
  photosBlocked,
  categoryLabel,
  categorySlug,
  title,
  priceLabel,
  conditionLabel,
  localityLabel,
  deliveryMethodLabel,
  categoryFamily,
  categorySpecifics,
  itemTypeLabel,
  ageSuitability,
  hygieneStatus,
  poweredToyStatusRequired,
  bookSetStatusRequired,
  educationalBookDetailsRequired,
  appliancePickupRequired,
  issueDisclosureRequired,
  issueDisclosure,
  confidenceByField = {},
}: {
  photoCount: number;
  minPhotos: number;
  photosBlocked: boolean;
  categoryLabel?: string | null;
  categorySlug?: string | null;
  title?: string | null;
  priceLabel?: string | null;
  conditionLabel?: string | null;
  localityLabel?: string | null;
  deliveryMethodLabel?: string | null;
  categoryFamily: 'toy' | 'book' | 'appliance' | 'device' | 'other';
  categorySpecifics: Record<string, any>;
  itemTypeLabel?: string | null;
  ageSuitability?: string | null;
  hygieneStatus?: string | null;
  poweredToyStatusRequired?: boolean;
  bookSetStatusRequired?: boolean;
  educationalBookDetailsRequired?: boolean;
  appliancePickupRequired?: boolean;
  issueDisclosureRequired?: boolean;
  issueDisclosure?: string | null;
  confidenceByField?: Record<string, number | undefined>;
}) {
  const issueDetail = compactValue(issueDisclosure);
  const disclosureAware = (
    baseValue: string,
    detailRequired: boolean,
  ): { value: string; summary: string; status: SmartReviewCheckStatus } => {
    const base = compactValue(baseValue);
    if (!base) return { value: '', summary: 'Needs answer', status: 'missing' };
    if (detailRequired && !issueDetail) {
      return { value: base, summary: `${base} - add detail`, status: 'missing' };
    }
    return {
      value: base,
      summary: detailRequired && issueDetail ? `${base}: ${issueDetail}` : base,
      status: valueStatus(base),
    };
  };

  const checks: SmartReviewCheck[] = [
    {
      id: 'photos',
      label: 'Photos',
      summary: photosBlocked ? 'Retake required' : photoCount >= minPhotos ? `${photoCount} ready` : `${Math.max(minPhotos - photoCount, 0)} more needed`,
      action: 'photos',
      requiredLevel: 'P0',
      status: photosBlocked || photoCount < minPhotos ? 'missing' : 'confirmed',
      source: 'seller',
      buyerVisible: true,
    },
    check({
      id: 'category',
      label: 'Category',
      value: categorySlug ? categoryLabel || categorySlug : '',
      action: 'category',
      source: 'ai',
      confidence: confidenceByField.category_slug,
    }),
    check({
      id: 'title',
      label: 'Title',
      value: title,
      action: 'title',
      source: 'ai',
      confidence: confidenceByField.title_suggestion,
    }),
    check({ id: 'price', label: 'Price', value: priceLabel, action: 'price', source: 'seller' }),
    check({ id: 'condition', label: 'Overall condition', value: conditionLabel, action: 'condition', source: 'seller' }),
    check({ id: 'locality', label: 'Pickup locality', value: localityLabel || 'From seller profile', action: 'location', source: 'system' }),
    check({ id: 'delivery_method', label: 'Fulfilment', value: deliveryMethodLabel || 'Pickup + Owmee delivery', action: 'delivery', source: 'system' }),
  ];

  if (categoryFamily === 'toy') {
    checks.splice(3, 0, check({
      id: 'toy_item_type',
      label: 'Item type',
      value: itemTypeLabel,
      action: 'model',
      source: 'seller',
    }));
    const partsSafety = disclosureAware(
      toyDisclosureValue(categorySpecifics),
      Boolean(issueDisclosureRequired),
    );
    checks.push(
      check({ id: 'age_suitability', label: 'Age suitability', value: ageSuitability, action: 'age_suitability', source: 'seller' }),
      check({
        id: 'toy_parts_safety',
        label: 'Parts & safety',
        value: partsSafety.value,
        summary: partsSafety.summary,
        status: partsSafety.status,
        action: 'category_specifics',
        source: 'seller',
      }),
      check({ id: 'toy_cleanliness', label: 'Cleanliness', value: hygieneStatus, action: 'hygiene_status', source: 'seller' }),
    );
    if (poweredToyStatusRequired) {
      checks.push(check({
        id: 'toy_power_status',
        label: 'Battery / working',
        value: readSpecific(categorySpecifics, 'working_status') || readSpecific(categorySpecifics, 'battery_status'),
        action: 'category_specifics',
        source: 'seller',
      }));
    }
  }

  if (categoryFamily === 'book') {
    const bookPages = disclosureAware(
      bookConditionValue(categorySpecifics),
      Boolean(issueDisclosureRequired),
    );
    checks.push(
      check({
        id: 'book_identity',
        label: 'Book type',
        value: readSpecific(categorySpecifics, 'book_type') || itemTypeLabel,
        action: 'model',
        source: 'seller',
      }),
      check({ id: 'book_language', label: 'Language', value: readSpecific(categorySpecifics, 'language'), action: 'category_specifics', source: 'seller' }),
      check({
        id: 'book_pages',
        label: 'Book condition',
        value: bookPages.value,
        summary: bookPages.summary,
        status: bookPages.status,
        action: 'category_specifics',
        source: 'seller',
      }),
    );
    if (educationalBookDetailsRequired) {
      checks.push(check({
        id: 'book_education_details',
        label: 'Class / board / edition',
        value: readSpecific(categorySpecifics, 'class_board_edition') || readSpecific(categorySpecifics, 'class_or_grade') || readSpecific(categorySpecifics, 'edition'),
        action: 'category_specifics',
        source: 'seller',
      }));
    }
    if (bookSetStatusRequired) {
      checks.push(check({ id: 'book_set_status', label: 'Set completeness', value: readSpecific(categorySpecifics, 'set_status'), action: 'category_specifics', source: 'seller' }));
    }
  }

  if (categoryFamily === 'appliance') {
    const applianceWorking = disclosureAware(
      applianceStatusValue(categorySpecifics),
      Boolean(issueDisclosureRequired),
    );
    checks.push(
      check({ id: 'appliance_type', label: 'Product type', value: readSpecific(categorySpecifics, 'appliance_type') || itemTypeLabel, action: 'model', source: 'seller' }),
      check({
        id: 'appliance_working',
        label: 'Condition details',
        value: applianceWorking.value,
        summary: applianceWorking.summary,
        status: applianceWorking.status,
        action: 'category_specifics',
        source: 'seller',
      }),
      check({ id: 'appliance_accessories', label: 'Accessories', value: readSpecific(categorySpecifics, 'accessories_status'), action: 'category_specifics', source: 'seller' }),
    );
    if (appliancePickupRequired) {
      checks.push(
        check({ id: 'appliance_pickup', label: 'Pickup effort', value: readSpecific(categorySpecifics, 'pickup_complexity'), action: 'category_specifics', source: 'seller' }),
        check({ id: 'appliance_installation', label: 'Power / installation', value: readSpecific(categorySpecifics, 'installation_status'), action: 'category_specifics', source: 'seller' }),
      );
    }
  }

  return checks;
}
