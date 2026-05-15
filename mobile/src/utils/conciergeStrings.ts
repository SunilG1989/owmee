/**
 * Single source of truth for all seller-facing Concierge copy.
 *
 * Per master spec section 10: don't hard-code strings in screen
 * components. Non-engineers iterate here without touching code.
 *
 * Specialist-facing strings (FE app) can stay inline — they're
 * internal and don't need this discipline.
 *
 * Naming rules (master spec section 11):
 *   - User-facing: "Owmee Concierge", "Owmee Specialist", "specialist visit"
 *   - Internal (DB / models / FE app code): "FE", "fe_visit", "field_executive"
 */

export const CONCIERGE_TAGS: Array<{ display: string; value: string }> = [
  { display: 'Phone', value: 'phone' },
  { display: 'Laptop', value: 'laptop' },
  { display: 'Audio', value: 'audio' },
  { display: 'Appliance', value: 'appliance' },
  { display: 'Kids stuff', value: 'kids' },
  { display: 'Multiple items', value: 'multiple' },
];

export const CONCIERGE_STRINGS = {
  forkScreen: {
    title: 'How would you like to sell?',
    concierge: {
      pillBadge: 'Recommended',
      heading: 'Owmee Concierge',
      tagline:
        'We help with photos, pricing, KYC guidance, ad creation, and pickup prep. List with verified trust.',
      bullets: [
        'Best price',
        'Expert pricing + safe inspection',
        'Pro-quality photos',
        'KYC trust badge',
      ],
      cta: 'Book a free visit',
    },
    selfService: {
      heading: 'List it myself',
      tagline:
        'We guide you through photos, pricing, verification, item details, and pickup support — you stay in control.',
      cta: 'Continue',
    },
    alreadyBooked: {
      label: 'Already booked. Want to track it?',
      cta: 'Track visit',
    },
  },
  booking: {
    title: 'Book a free Owmee visit',
    whereLabel: 'Where?',
    whereChange: 'Change',
    whereSetUp: 'Set up your address first',
    whereSetUpCta: 'Add address',
    whenLabel: 'When?',
    moreTimes: 'More times',
    fewerTimes: 'Fewer times',
    notesLabel: 'Anything we should know? (optional)',
    notesHint:
      'Examples: "old phone + charger" · "5 items, mixed" · "have original box"',
    notesPlaceholder: 'Or type freely…',
    notesQuickTagsTitle: 'Quick tags (tap to add):',
    submitCta: 'Book free visit',
    fullyBooked: "We're booked for the next week — try again soon.",
    submitError: "Couldn't book the visit. Please try again.",
  },
  bookingConfirmed: {
    title: '✓ Visit booked',
    matchingMessage:
      "We're matching you with an Owmee Specialist now. You'll get a notification once confirmed.",
    addToCalendar: 'Add to calendar',
    trackVisit: 'Track visit',
    backHome: 'Back to home',
  },
};
