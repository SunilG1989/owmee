# Owmee Concierge — Master Specification

**Version:** 2.0 (consolidated)
**Owner:** Sunil (founder)
**Date:** 2026-05-02
**Status:** Final — for Claude Code implementation
**Supersedes:** All earlier Concierge docs (PM spec v1.0, implementation prompt v1.0, booking simplification addendum). This is the single source.

---

## 0. How to read this document

This is both the product spec AND the implementation guide. It's organized by phase, and each phase has:

- **Why** — what user problem the phase solves
- **What** — user-visible behavior, screens, copy
- **How** — backend schema, endpoints, mobile screens, navigation
- **Acceptance** — concrete tests Claude Code must pass

If you only have time to read one section, read Section 1 (the seller's emotional journey). Everything else exists to serve it.

If you're Claude Code — read the WHOLE thing before writing a single line of code. The phases are interdependent in non-obvious ways; jumping in at Phase 3 without understanding Phase 1's data shape will produce wrong code.

---

## 1. The seller's emotional journey

This is the spine of the entire feature. Every UI decision, every API field, every notification serves this journey.

### Stage 1 — Discovery (5 seconds)

Seller taps "Sell" in the bottom tab. They see a fork:

- **Hero card (70% visual weight): Owmee Concierge.** "We come home. We photograph. We price. We list. We pack. We ship. You do nothing." Free home visit. One CTA.
- **Smaller card (30%): List it myself.** For sellers who want to do it the OLX way.

The asymmetry is the message: "you should pick concierge." A balanced fork undermines the value prop.

### Stage 2 — Booking (30 seconds, two taps minimum)

ONE screen. Pre-filled address (default from saved). Four slot chips. Optional notes with quick tags. "Book free visit" button.

Friction kills conversion in this moment. We will NOT ask for category, item count, estimated value, or anything else. The free-text notes field with 6 quick tags collects everything ops genuinely needs.

### Stage 3 — Anticipation (between booking and visit)

Most product flows go silent here. We don't.

Six push notifications across the booking → visit window:
1. "Visit booked, matching specialist now" (within 60s)
2. "Vikram is your Owmee Specialist" (within 4 hours, after admin assigns)
3. "Vikram visits tomorrow, 2-4pm" + light prep checklist (8pm day before)
4. "Vikram is starting his visits, ETA 2:30pm" (specialist taps "start route")
5. "Arriving in 30 mins" (computed)
6. "Vikram is at your door — Code: 4729" (specialist taps "arrived")

Each notification pulls the seller deeper into "this is real" mental state. Showing the specialist's face + rating + verification builds trust before they ring the doorbell.

### Stage 4 — Visit (the magic moment)

Specialist arrives. Mutual code verification at door. Walks in with context: knows seller's name, address, what they tagged.

For each item:
1. Specialist photographs (existing flow with photo prompts)
2. AI extracts brand/model/condition (existing Gemini integration)
3. **Expert pricing panel shows the specialist real data**: "23 similar phones sold for ₹11,000-15,500 in last 60 days. Median: ₹13,500. Sells in ~4 days."
4. Specialist explains rationale to seller verbally
5. Specialist hands phone to seller for approval tap
6. Listing publishes with "Verified by Owmee specialist" badge

The expert pricing panel is what makes the specialist look like a pro instead of a delivery worker. This is the feature that makes Concierge feel premium.

### Stage 5 — Listing & sale (passive, days/weeks)

Seller does nothing. Sees a "My Concierge" timeline view as their home base:
- Each visit grouped as a card
- Items under each visit with status (Live / Sold / Pending pickup)
- Pending earnings totaled
- Tap any item → existing listing or transaction detail

When an item sells: push notification with the sale amount and pickup info.
When pickup completes: push notification with delivery ETA.
When money lands: push notification with full breakdown (gross / TDS / net).

Transparency at every step. No surprises.

### Stage 6 — Pickup (second specialist touch)

When an item sells, FE returns to seller's home for packaging + pickup. Same specialist when possible — continuity matters.

Chain-of-custody photo at handoff: both phone and item on camera. Seller has receipt. If item is damaged in transit, Owmee eats the loss and pays the seller fully (trust fund pattern).

### Stage 7 — Money (1-2 days after sale)

Seller's account ending 4789 receives ₹8,415 (gross 8,500 - ₹85 TDS).

Notification breaks it down: gross, fees (₹0 in pilot), TDS, net. Tax statement available in settings.

This is the moment the seller becomes a champion or a churn statistic. Get it right.

---

## 2. Locked product decisions

These are non-negotiable. Don't deviate without explicit user sign-off.

### Naming

| Concept | User-facing | Internal (code/DB/admin) |
|---------|-------------|--------------------------|
| The feature | "Owmee Concierge" | `concierge` / `fe_visit` |
| The person who visits | "Owmee Specialist" | "FE" / `field_executive` |
| The visit | "specialist visit" / "home visit" | `fe_visit` |

Don't rename internal models. That's a 3-day refactor for zero user value. Only seller-facing strings change.

### Pricing (pilot phase)

- ₹0 visit fee
- ₹0 listing fee
- ₹0 commission
- The booking flow says nothing about pricing, ever. There is no fee, no commission, no asterisk. The word "free" appears in CTAs ("Book free visit") as the trust signal.
- DB has a `commission_pct` field — set to 0 for pilot, don't remove.

### Phasing

Strict 1 → 2 → 3 → 4 → 5. No bundling. No skipping. Each phase ships standalone, gets user acceptance, then the next starts.

### Premium feel

Non-negotiable across all phases. Trust theater (Phase 2), expert pricing (Phase 3), passive timeline (Phase 4) — none are "nice-to-have." Without them, sellers book once, get confused, churn.

### What we're NOT building

(Out of scope — don't suggest, don't add):
- Subscriptions, premium tiers, loyalty
- Voice notes, video listings, social proof carousel
- AI-based pricing beyond simple SQL aggregation
- iOS-first features (Android-only for pilot)
- Cross-city expansion logic (Bengaluru only)
- Specialist re-rating beyond NPS
- Buyer-side experience changes (separate spec when we get there)
- Real Razorpay integration (separate Tier 2 task per pilot triage)
- Real Digio KYC (deferred per pilot triage)

---

## 3. Prerequisites

Before any Concierge work starts, these must be in place:

### 3.1 Use case 1: persistent login (1-2 hours)

**Status: pending separate work.**

Sellers currently get OTP-prompted on every app close-and-reopen. The auth store DOES use AsyncStorage (verified in code at `mobile/src/store/authStore.ts`), so the bug is NOT "tokens never persisted." It's somewhere else — probably hydration on app boot, or refresh-call failure triggering logout.

**Diagnose first, fix second.** Read `mobile/src/store/authStore.ts`, `mobile/src/services/api.ts`, and the app's root navigator hydration. Find the actual gap. Don't assume.

Acceptance: login → force-stop app → reopen → land on home, no OTP. Three times in a row.

### 3.2 Use case 2: address system (3-4 days, Phase 1 of address PRD)

**Status: pending separate work, depends on this PRD: `owmee_address_location_prd.md` (in Downloads).**

Concierge booking flow CANNOT ship without `user_addresses` table existing. The booking screen uses an address picker that pulls from saved addresses; if there's no saved-addresses concept, there's nothing to pick.

Implementation order:
1. Address PRD Phase 1 ships
2. THEN Concierge Phase 1 starts

If Claude Code starts Concierge before the address system is ready, stop and tell the user.

### 3.3 FCM mobile wiring

**Status: backend ready, mobile not wired.**

Per `PILOT_READINESS.md`, the backend FCM service exists at `backend/app/modules/notifications/service.py` (245 lines, working). What's missing is the mobile half: `@react-native-firebase/messaging` is not in `mobile/package.json`. No token retrieval, no permission request, no register call.

Concierge Phase 2 (trust theater notifications) needs FCM. Two options:

- **Option A:** ship FCM mobile wiring as part of Concierge Phase 2 (adds ~1 day to Phase 2)
- **Option B:** ship FCM mobile wiring as a standalone task before Concierge Phase 2 (cleaner; FCM will be needed for non-Concierge things too)

Recommend Option B if there's bandwidth. Either way, Phase 2 ships with working push notifications. No fallback to in-app alerts only.

---

## 4. Phase 1 — Discovery + booking (the front door)

**Goal:** Replace "tap Sell → AIListingCamera" with a Concierge-first fork screen and a one-screen booking flow.

**Depends on:** Address PRD Phase 1 shipped (Section 3.2).

**Effort:** 2 days.

### 4.1 Why

Right now, "Sell" leads directly to the self-service photograph-and-list flow. Concierge isn't visible. Sellers don't know it exists.

Step 1: surface Concierge as the recommended option. Step 2: when they pick it, get them booked in 30 seconds with two required taps.

### 4.2 What — fork screen

```
┌─────────────────────────────────────────────────┐
│                                                  │
│   How would you like to sell?                   │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │                                          │   │
│  │   ✨  Owmee Concierge       Recommended │   │
│  │                                          │   │
│  │   We come home. We photograph. We       │   │
│  │   price. We list. We pack. We ship.     │   │
│  │   You do nothing.                        │   │
│  │                                          │   │
│  │   ✓ Free home visit                      │   │
│  │   ✓ Expert pricing — sells faster        │   │
│  │   ✓ No buyer haggling                    │   │
│  │   ✓ Money in your bank in 5 days         │   │
│  │                                          │   │
│  │              [Book a free visit →]       │   │
│  │                                          │   │
│  └─────────────────────────────────────────┘   │
│                                                  │
│  ┌─────────────────────────────────────────┐   │
│  │   📷  List it myself                     │   │
│  │                                          │   │
│  │   For sellers who have time to take     │   │
│  │   photos, set prices, and handle         │   │
│  │   buyer messages themselves.             │   │
│  │                                          │   │
│  │                              [Continue →]│   │
│  └─────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Visual rules:**
- Concierge card: ~70% screen real estate. Cream background (`C.cream`), honey accents (`C.honey`).
- Self-service card: ~30%. Surface gray (`C.surface`), text-2 muted text.
- "Recommended" pill on Concierge top-right. Honey background, cream text.
- Both cards are tappable in their entirety. Big tap targets.
- No "Compare" link. No "Help me decide" modal. Friction kills conversion.

### 4.3 What — booking screen

ONE screen. Replaces the previously-spec'd 3-step wizard.

```
┌─────────────────────────────────────────┐
│ ← Book a free Owmee visit               │
├─────────────────────────────────────────┤
│                                          │
│  📍 Where?                               │
│  ┌─────────────────────────────────┐   │
│  │ 🏠 Home                          │   │
│  │ Flat 304, Lotus Apartments       │   │
│  │ JP Nagar, Bengaluru              │   │
│  │                       [Change ▾] │   │
│  └─────────────────────────────────┘   │
│                                          │
│  🕐 When?                                │
│  ┌──────────┐ ┌──────────┐             │
│  │ Tomorrow │ │ Tomorrow │             │
│  │ 10am-12  │ │  2-4pm   │             │
│  └──────────┘ └──────────┘             │
│  ┌──────────┐ ┌──────────┐             │
│  │   Wed    │ │   Wed    │             │
│  │ 10am-12  │ │  2-4pm   │             │
│  └──────────┘ └──────────┘             │
│                       [More times ▾]    │
│                                          │
│  💬 Anything we should know? (optional) │
│                                          │
│  Examples: "old phone + charger" ·       │
│  "5 items, mixed" · "have original box" │
│                                          │
│  Quick tags (tap to add):                │
│  [Phone] [Laptop] [Audio] [Appliance]   │
│  [Kids stuff] [Multiple items]           │
│                                          │
│  ┌─────────────────────────────────┐   │
│  │ Or type freely…                  │   │
│  │                                  │   │
│  └─────────────────────────────────┘   │
│                                          │
│         [ Book free visit ]              │
└─────────────────────────────────────────┘
```

**Required:** address + slot.
**Optional:** notes (free text + 6 quick tags).
**Submit button:** disabled until both required fields are picked.

#### Field rules

**Where:**
- Default address is pre-selected on screen mount.
- "Change ▾" expands inline picker showing all saved addresses + "Add new address" link. Tap to select; collapses.
- If user has 0 saved addresses: card shows "Set up your address first" + button → routes to LocationDetect (address PRD's first screen) → returns here with new address pre-selected.

**When:**
- 4 slot chips visible by default: next 2 days × 2 slots (10am-12, 2pm-4pm).
- Past slots are hidden. (If it's 11am, today's 10am-12 slot is hidden.)
- "More times ▾" expands inline to show next 5 days × 4 slots/day.
- Tap to select; tap again to deselect. Selected state has filled background.

**Notes:**
- 6 quick tags above the textarea. Tapping appends the label to the textarea (with comma separator). Tapping again removes it.
- Tags map to canonical DB values: `Phone → phone`, `Laptop → laptop`, `Audio → audio`, `Appliance → appliance`, `Kids stuff → kids`, `Multiple items → multiple`.
- Textarea: 500 char limit. No required validation.
- The textarea and tags are independent — user can edit textarea after tapping tags. Both `notes` (text) and `notes_tags` (array) are submitted.

#### Edge cases

- All slots in next 7 days are full → show "We're booked for the next week — try again soon." Don't hide screen.
- API error on submit → inline error below button. Form values preserved.
- Submit button double-tap → debounce; button disabled until response.
- User pulls down to refresh slot availability → optional, nice-to-have not required.

### 4.4 What — booking confirmed screen

```
┌─────────────────────────────────────────┐
│                                          │
│         ✓ Visit booked                   │
│                                          │
│   Tomorrow, 2-4pm                        │
│   Flat 304, Lotus Apartments             │
│                                          │
│   We're matching you with an Owmee      │
│   Specialist now. You'll get a           │
│   notification once confirmed.           │
│                                          │
│   [Add to calendar]                      │
│   [Track visit]                          │
│                                          │
└─────────────────────────────────────────┘
```

- "Add to calendar" → uses `react-native-add-calendar-event` (existing dep or add) to create native calendar event.
- "Track visit" → navigates to `MyConciergeScreen` (built in Phase 4). For Phase 1, this can be a placeholder "Coming soon" — Phase 4 implements the real screen. Don't gate Phase 1 on Phase 4.

### 4.5 How — backend

#### Migration `0034_concierge_visit_fields.py`

```python
def upgrade() -> None:
    op.add_column(
        'fe_visits',
        sa.Column(
            'notes_tags',
            sa.JSON(),
            nullable=False,
            server_default='[]',
            comment="Tags from booking: ['phone', 'laptop', etc.]"
        )
    )

def downgrade() -> None:
    op.drop_column('fe_visits', 'notes_tags')
```

Tag values: `phone | laptop | audio | appliance | kids | multiple`. Validate at API layer; don't enforce in DB.

**Don't add** `item_count_estimate`, `estimated_total_value_inr`, `multi_category`. The simplified booking flow doesn't collect these.

#### Schema update — `RequestVisitRequest`

Replace existing in `backend/app/modules/field_executive/router.py`:

```python
ALLOWED_TAGS = {'phone', 'laptop', 'audio', 'appliance', 'kids', 'multiple'}

class RequestVisitRequest(BaseModel):
    requested_slot_start: datetime
    requested_slot_end: datetime
    address_id: str  # NEW: replaces inline address fields
    notes: Optional[str] = Field(None, max_length=500)
    notes_tags: List[str] = Field(default_factory=list, max_items=6)

    @field_validator('notes_tags')
    @classmethod
    def validate_tags(cls, v: List[str]) -> List[str]:
        invalid = set(v) - ALLOWED_TAGS
        if invalid:
            raise ValueError(f"Invalid tags: {invalid}. Allowed: {ALLOWED_TAGS}")
        # Dedupe
        return list(dict.fromkeys(v))
```

Handler logic in the request endpoint:

1. Resolve `address_id` to a `user_addresses` row owned by the requester. 404 if not owned.
2. Snapshot the address into `fe_visits.address_snapshot` (JSONB) — preserves the existing snapshot pattern.
3. `category_hint` is no longer required from the request body. Set to `'unknown'` in DB. Real category gets locked at admin assignment time (existing flow — admin picks category when assigning specialist).
4. Save `item_notes = notes`, `notes_tags = notes_tags`.

Update `VisitResponse` to include `notes_tags`.

#### Address snapshot shape

When snapshotting from a `user_addresses` row, write this JSONB into `fe_visits.address_snapshot`:

```json
{
  "address_id": "uuid",
  "label": "home",
  "lat": 12.9176,
  "lng": 77.5894,
  "flat_house_number": "Flat 304",
  "building_name": "Lotus Apartments",
  "floor": "3rd floor",
  "landmark": "Near Diary Circle",
  "address_line_1": "12th Main Road",
  "locality": "JP Nagar Phase 7",
  "city": "Bengaluru",
  "state": "Karnataka",
  "pincode": "560078"
}
```

This is the shape the FE app will read for navigation + briefing in Phase 3.

### 4.6 How — mobile

#### File structure

```
mobile/src/screens/listings/
  SellModeForkScreen.tsx              ← NEW
  RequestFeVisitScreen.tsx            ← DEPRECATED (delete in Phase 5)
  concierge/
    BookingScreen.tsx                 ← NEW
    BookingConfirmedScreen.tsx        ← NEW

mobile/src/utils/
  conciergeStrings.ts                 ← NEW (single source for all Concierge copy)
```

#### Strings file

Create `mobile/src/utils/conciergeStrings.ts`. All Concierge user-facing copy lives here. Non-engineers can iterate.

```typescript
export const CONCIERGE_STRINGS = {
  forkScreen: {
    title: 'How would you like to sell?',
    concierge: {
      pillBadge: 'Recommended',
      heading: 'Owmee Concierge',
      tagline: 'We come home. We photograph. We price. We list. We pack. We ship. You do nothing.',
      bullets: [
        'Free home visit',
        'Expert pricing — sells faster',
        'No buyer haggling',
        'Money in your bank in 5 days',
      ],
      cta: 'Book a free visit',
    },
    selfService: {
      heading: 'List it myself',
      tagline: 'For sellers who have time to take photos, set prices, and handle buyer messages themselves.',
      cta: 'Continue',
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
    notesLabel: 'Anything we should know? (optional)',
    notesHint: 'Examples: "old phone + charger" · "5 items, mixed" · "have original box"',
    notesPlaceholder: 'Or type freely…',
    notesQuickTagsTitle: 'Quick tags (tap to add):',
    notesQuickTags: [
      { display: 'Phone', value: 'phone' },
      { display: 'Laptop', value: 'laptop' },
      { display: 'Audio', value: 'audio' },
      { display: 'Appliance', value: 'appliance' },
      { display: 'Kids stuff', value: 'kids' },
      { display: 'Multiple items', value: 'multiple' },
    ],
    submitCta: 'Book free visit',
    fullyBooked: "We're booked for the next week — try again soon.",
  },
  bookingConfirmed: {
    title: '✓ Visit booked',
    matchingMessage: "We're matching you with an Owmee Specialist now. You'll get a notification once confirmed.",
    addToCalendar: 'Add to calendar',
    trackVisit: 'Track visit',
  },
};
```

#### `SellModeForkScreen.tsx`

Use existing tokens (`mobile/src/utils/tokens.ts`). Concierge card uses `C.cream` background; self-service uses `C.surface`. Tap navigates.

```
Concierge card → BookingScreen
Self-service card → existing AIListingCamera (or whatever current "Sell" leads to)
```

#### `BookingScreen.tsx`

State management:

```typescript
const { data: addresses } = useQuery(['my-addresses'], Auth.getAddresses);
const defaultAddress = addresses?.find(a => a.is_default) ?? addresses?.[0];

const [addressId, setAddressId] = useState<string | null>(defaultAddress?.id ?? null);
const [slotStart, setSlotStart] = useState<Date | null>(null);
const [slotEnd, setSlotEnd] = useState<Date | null>(null);
const [notes, setNotes] = useState('');
const [notesTags, setNotesTags] = useState<string[]>([]);
const [showAddressPicker, setShowAddressPicker] = useState(false);
const [showMoreSlots, setShowMoreSlots] = useState(false);

const canSubmit = !!addressId && !!slotStart;
```

Tag toggle:

```typescript
const toggleTag = (tag: { display: string; value: string }) => {
  if (notesTags.includes(tag.value)) {
    setNotesTags(prev => prev.filter(t => t !== tag.value));
    setNotes(prev => prev.replace(new RegExp(`\\b${tag.display}\\s*,?\\s*`, 'g'), '').trim().replace(/^,\s*/, ''));
  } else {
    setNotesTags(prev => [...prev, tag.value]);
    setNotes(prev => prev ? `${prev}, ${tag.display}` : tag.display);
  }
};
```

Slot rendering: always show the next 2 days × 2 slots, hiding past slots. "More times ▾" expands to next 5 days × 4 slots.

Submit:

```typescript
const onSubmit = async () => {
  try {
    const visit = await FEVisits.request({
      requested_slot_start: slotStart!.toISOString(),
      requested_slot_end: slotEnd!.toISOString(),
      address_id: addressId!,
      notes: notes || null,
      notes_tags: notesTags,
    });
    navigation.replace('BookingConfirmedScreen', { visit });
  } catch (e) {
    showError(extractError(e));
  }
};
```

#### `BookingConfirmedScreen.tsx`

Read visit details from route params. Render confirmation. Two CTAs: Add to Calendar, Track Visit.

#### Navigation wiring

In `RootNavigator.tsx`, modify the Sell tab handler:

```
Sell tab handler:
  if (user is authenticated):
    navigate to SellModeForkScreen
  else:
    show auth modal with intent='sell'
```

When authenticated user taps Sell, they always land on SellModeForkScreen first. From there:
- Concierge card → BookingScreen
- Self-service card → AIListingCamera (existing flow)

The KYC gate, if any, is preserved on the self-service path. The Concierge path does NOT require KYC (FE-assisted listing has its own verification flow built into the visit).

#### Old `RequestFeVisitScreen.tsx`

Mark deprecated. Don't delete in Phase 1; some path may still reference it. Add comment at top:

```typescript
/**
 * @deprecated Replaced by Concierge BookingScreen. Delete in Phase 5.
 */
```

Remove from RootNavigator stack registration in Phase 1; Phase 5 deletes the file.

### 4.7 Acceptance — Phase 1

1. Open app as authenticated user with at least one saved address. Tap Sell tab. See SellModeForkScreen. Concierge card on top, Recommended pill, ~70% visual weight. Self-service smaller below.

2. Tap Concierge card. Land on BookingScreen.

3. Default address is pre-selected (visible in the Where card with label, building, locality, city).

4. Submit button is disabled.

5. Tap "Tomorrow 2-4pm" slot. Submit button now enabled.

6. Tap "Phone" tag. Verify "Phone" appears in notes textarea.

7. Type ", and a tablet" after "Phone". Notes now reads "Phone, and a tablet". `notes_tags = ['phone']` is internal state.

8. Tap "Multiple items" tag. Verify "Multiple items" appended to textarea.

9. Tap Submit. See success state. Backend `fe_visits` row exists with:
   - `address_snapshot` = JSONB of the chosen address (matching shape in Section 4.5)
   - `requested_slot_start` / `requested_slot_end` = correct timestamps
   - `item_notes` = "Phone, and a tablet, Multiple items"
   - `notes_tags` = `['phone', 'multiple']`
   - `status` = `'requested'`

10. Self-service path also works: from SellModeForkScreen, tap "List it myself", land in existing AIListingCamera.

11. User with 0 saved addresses opens BookingScreen → Where card shows "Set up your address first" + button. Tap → LocationDetect flow → complete → return to BookingScreen with new address pre-selected.

### 4.8 Phase 1 commit

```
git commit -m "Concierge Phase 1: fork screen + one-screen booking"
git push origin main
```

**STOP. Wait for user acceptance before starting Phase 2.**

---

## 5. Phase 2 — Trust theater (between booking and visit)

**Goal:** Six push notifications across the booking → visit window. Specialist profile card. Mutual verification code at door.

**Depends on:** FCM mobile wiring (Section 3.3).

**Effort:** 2-3 days (1 day if FCM is shipped separately; 3 if bundled).

### 5.1 Why

After "Visit booked, matching specialist now," most apps go silent. The seller wonders if anything is happening. By the time the specialist arrives, the seller has lost confidence.

We don't go silent. Six deliberate touch points across 24-72 hours, each carrying a trust signal.

### 5.2 What — six notifications

#### N1: Visit booked (within 60s of booking)

```
✓ Visit booked

We're matching you with an Owmee Specialist
now. You'll get a notification once confirmed.
```

Already shown in BookingConfirmedScreen + push. Triggers on `POST /v1/fe-visits/request`.

#### N2: Specialist assigned

```
🚚 Vikram is your Owmee Specialist

Vikram K. · 4.8★ · 142 visits
Verified by Owmee
Tap to see profile →
```

Triggered when admin assigns FE to visit (existing admin web action). Deep-links to visit detail screen showing specialist profile card.

#### N3: Day-before reminder (8pm IST day before)

```
👋 Vikram visits tomorrow, 2-4pm

Quick prep that helps:
• Charge devices to 50%+ if possible
• Find original boxes/chargers if you have them
• Have ID handy (for verification)

Don't worry if you can't do all — we'll figure it out.
```

The "don't worry" line removes the anxiety of failing some test.

#### N4: On-the-way (specialist taps "Start route" in FE app)

```
📍 Vikram is starting his visits

Estimated arrival: 2:30pm
Tap to track →
```

Deep-links to live tracking (Sprint 6c logistics has the bones).

#### N5: Arriving in 30 mins (computed)

```
Vikram arriving in 30 mins
```

Computed from FE's location vs seller's address. If we don't have live location yet (Phase 2), trigger on specialist action "I'm 30 mins away" button in FE app.

#### N6: At the door (specialist taps "Arrived")

```
👋 Vikram is at your door — Code: 4729

Tap to verify →
```

Deep-links to a verification screen (Section 5.4). Code is the visit's `arrival_verification_code`.

### 5.3 What — specialist profile card

When N2 fires, the seller can see the specialist's profile inline in the visit detail screen.

```
┌─────────────────────────────────────┐
│  [photo]  Vikram K.                 │
│                                      │
│           4.8★ · 142 visits          │
│           Joined 2025                │
│                                      │
│           ✓ Verified by Owmee       │
│           ✓ Background-checked       │
│                                      │
│              [See profile →]         │
└─────────────────────────────────────┘
```

Tapping "See profile" opens a modal with: bio (default text for pilot), languages spoken, areas they specialize in. For pilot, hardcode reasonable defaults; expand in Year 2.

The `name` field shows first name + last initial. Never full last name (privacy + brand polish).

### 5.4 What — mutual verification at door

#### Specialist's view (FE app)

When specialist taps "Arrived" in `FeVisitDetailScreen`:

```
You're at Sunil's place

Tell Sunil this code so he knows it's you:

       4 7 2 9

[I told the seller the code]
```

Tapping confirms updates visit `status` to `in_progress`.

#### Seller's view (notification + screen)

N6 push deep-links to:

```
👋 Vikram is at your door

Verify it's really Vikram —
he should tell you this code:

       4 7 2 9

[ ✓ Vikram told me this code ]
[ ⚠️ Code didn't match ]
```

Tap "code matched" → updates visit status to `in_progress` from seller side.
Tap "didn't match" → opens emergency flow:

```
⚠️ Don't open the door.

We're calling you in 60 seconds to verify
what's going on.

If you feel unsafe, call your local emergency number.
```

Backend creates an `fe_visit_issue` row with severity `urgent` and category `safety_concern`. Admin web shows alert. For pilot, ops manually responds. (Phase 5's automated alerting handles this better.)

### 5.5 How — backend

#### Migration `0035_concierge_trust.py`

```python
def upgrade() -> None:
    op.add_column(
        'fe_visits',
        sa.Column(
            'arrival_verification_code',
            sa.String(4),
            nullable=True,
            comment="4-digit code for at-door mutual verification"
        )
    )
    op.add_column(
        'fe_visits',
        sa.Column(
            'arrival_confirmed_by_seller_at',
            sa.DateTime(timezone=True),
            nullable=True,
        )
    )

def downgrade() -> None:
    op.drop_column('fe_visits', 'arrival_confirmed_by_seller_at')
    op.drop_column('fe_visits', 'arrival_verification_code')
```

#### Code generation

When a visit is created (in `POST /v1/fe-visits/request` handler):

```python
import secrets
arrival_code = f"{secrets.randbelow(10000):04d}"  # zero-padded 4-digit
```

Store on the `fe_visits` row.

#### New endpoint: `GET /v1/fe-visits/{visit_id}/specialist-profile`

Auth: required. Visit must belong to the requesting user (seller-side).

```python
class SpecialistProfileResponse(BaseModel):
    specialist_id: str
    name: str  # "Vikram K." (first + last initial)
    photo_url: Optional[str]
    rating_avg: float
    visit_count_total: int
    joined_year: int
    verified: bool  # always true if assigned
    background_checked: bool  # for pilot, always true
```

Implementation: read from `field_executives` joined `users`. Compute `rating_avg` from `fe_visit_nps` table (Phase 5 introduces this; for Phase 2, default to 5.0 if no rows).

#### New endpoint: `POST /v1/fe-visits/{visit_id}/seller-confirm-arrival`

Auth: required. Visit must belong to the requesting user.

```python
class SellerConfirmArrivalRequest(BaseModel):
    code_matched: bool
```

Behavior:
- If `code_matched`: set `arrival_confirmed_by_seller_at = now()`, advance visit status to `in_progress`.
- If NOT matched: create `fe_visit_issue` with severity `urgent`, category `safety_concern`. Don't advance status. Return 200 with `{"alerted": true}`.

#### Notification triggers

In `backend/app/modules/notifications/concierge_templates.py` (new file):

```python
from app.modules.notifications.service import send_notification

async def notify_specialist_assigned(db, visit, specialist_user):
    await send_notification(
        db,
        user_id=visit.seller_id,
        title=f"🚚 {specialist_user.first_name} is your Owmee Specialist",
        body=f"{specialist_user.first_name} K. · 4.8★ · 142 visits · Verified by Owmee",
        deep_link={
            'screen': 'VisitDetail',
            'params': {'visit_id': str(visit.id)}
        },
    )

# ... 5 more functions for N3-N6
```

Trigger points (all in `backend/app/modules/field_executive/service.py`):

| Trigger | Notification function |
|---------|----------------------|
| Admin assigns specialist | `notify_specialist_assigned` |
| Day-before scheduled (Temporal cron) | `notify_day_before_reminder` |
| Specialist taps "start route" | `notify_specialist_starting` |
| Specialist taps "30 mins away" | `notify_specialist_arriving_soon` |
| Specialist taps "arrived" | `notify_specialist_at_door` |

Day-before is a Temporal scheduled workflow that fires at 8pm IST for any visit with `scheduled_slot_start` between (now+15h) and (now+39h).

### 5.6 How — mobile

#### FCM wiring (if not already shipped)

```bash
cd mobile
npm install @react-native-firebase/app @react-native-firebase/messaging
```

Android: add `google-services.json` to `mobile/android/app/`. Update `mobile/android/build.gradle` and `mobile/android/app/build.gradle` per Firebase RN setup.

iOS: stub out (skip for pilot — Android only — but don't let iOS builds error).

Create `mobile/src/services/notifications.ts`:

```typescript
import messaging from '@react-native-firebase/messaging';
import { Auth } from './api';

export async function setupFCM() {
  // Permission
  const authStatus = await messaging().requestPermission();
  if (authStatus !== messaging.AuthorizationStatus.AUTHORIZED) return;

  // Token
  const token = await messaging().getToken();
  await Auth.registerFcmToken(token);

  // Refresh on change
  messaging().onTokenRefresh(async (newToken) => {
    await Auth.registerFcmToken(newToken);
  });

  // Foreground handler
  messaging().onMessage(handleForegroundNotification);

  // Background-tap handler (when user taps a delivered notification)
  messaging().onNotificationOpenedApp(handleNotificationTap);

  // Cold-start handler (when app launches from a notification)
  const initialMsg = await messaging().getInitialNotification();
  if (initialMsg) handleNotificationTap(initialMsg);
}
```

Wire into app boot in `App.tsx` after auth hydration completes.

Deep-link routing: `handleNotificationTap` reads `data.deep_link` from the notification payload, looks up the screen + params, navigates.

#### `SpecialistProfileCard` component

```
mobile/src/components/concierge/SpecialistProfileCard.tsx
```

Reads from `GET /v1/fe-visits/{id}/specialist-profile`. Renders the card layout from Section 5.3.

Used in:
- `VisitDetailScreen` (after specialist is assigned)
- The day-before reminder deep-link target

#### `ArrivalVerificationScreen`

```
mobile/src/screens/listings/concierge/ArrivalVerificationScreen.tsx
```

Reads visit's `arrival_verification_code` from API. Shows the layout from Section 5.4. Two buttons call the seller-confirm-arrival endpoint with `code_matched: true/false`.

### 5.7 Acceptance — Phase 2

1. Book a visit (Phase 1 flow). Confirm N1 push arrives within 60s.
2. As admin (admin web), assign a specialist. As seller, confirm N2 push arrives. Open it → land on visit detail with `SpecialistProfileCard` rendered showing name, rating, visit count.
3. Manipulate `scheduled_slot_start` in dev to trigger day-before. Verify N3 push arrives with prep checklist.
4. As specialist (FE app), tap "Start route." Verify N4 push to seller.
5. As specialist, tap "I'm 30 mins away." Verify N5 push.
6. As specialist, tap "Arrived." See code in FE app.
7. As seller, receive N6. Tap. Land on ArrivalVerificationScreen showing same code. Tap "Code matched." Verify visit status moves to `in_progress`.
8. Test "didn't match": as seller, tap that button. Verify `fe_visit_issue` row created with severity `urgent`. Admin web shows alert.

### 5.8 Phase 2 commit

```
git commit -m "Concierge Phase 2: trust theater notifications + verification code"
git push origin main
```

**STOP. Wait for user acceptance before starting Phase 3.**

---

## 6. Phase 3 — Specialist excellence at the visit

**Goal:** The specialist arrives looking like a pro, not a delivery worker. Pre-visit briefing + expert pricing panel + multi-item per visit + seller approval.

**Effort:** 2 days.

### 6.1 Why

This is where the seller decides if they trust the brand. A specialist who eyeballs prices loses the seller. A specialist who shows real data gains a champion.

### 6.2 What — pre-visit briefing

When specialist taps a visit in `FeHomeScreen`, the visit detail shows:

```
┌─────────────────────────────────────┐
│ Visit at 2-4pm today                │
│                                      │
│ Sunil M.                             │
│ Flat 304, Lotus Apartments,          │
│ JP Nagar Phase 7                     │
│ [📍 Navigate]                        │
│                                      │
│ Tags: phone, multiple                │
│ Notes: "old phone + charger,         │
│        maybe a tablet too"           │
│                                      │
│ Verification code: 4729              │
│ (Tell the seller when they ask)      │
│                                      │
│              [I've arrived →]        │
└─────────────────────────────────────┘
```

Tags line: comma-joined `notes_tags` from booking. Skip if empty.
Notes line: shows `item_notes`. Skip if empty.
If both empty: show "(no specifics provided)".

[I've arrived] triggers visit `in_progress` status and N6 push to seller (Phase 2).

### 6.3 What — expert pricing panel (the magic)

Single most important UI in this whole feature.

When specialist enters brand + (optional) model + condition in `FeCaptureScreen`, fire `GET /v1/listings/price-suggestion`. While loading, show skeleton in price area. When loaded:

```
┌─────────────────────────────────────────────┐
│ Suggested price for this Samsung Galaxy S22 │
│                                              │
│   ₹13,500                                    │
│   median sold price (last 60 days)           │
│                                              │
│   Sold range: ₹11,000 – ₹15,500              │
│   Based on 23 similar items                  │
│   Sells in ~4 days at this price             │
│                                              │
│   ┌────────────────────┐                    │
│   │ Faster sell ₹12,500│                    │
│   └────────────────────┘                    │
│   ┌────────────────────┐                    │
│   │ Premium     ₹14,500│                    │
│   └────────────────────┘                    │
│                                              │
│   Or set custom: [_________]                 │
│                                              │
│   These are real Owmee sale prices —         │
│   show the seller for transparency.          │
└─────────────────────────────────────────────┘
```

Tapping a chip auto-fills the price input. Custom override available.

**Specialist verbal script in person (training):**
> "In the last two months, 23 phones like yours sold on Owmee for ₹11,000 to ₹15,500. The most common selling price is ₹13,500. Yours has a clean back and 88% battery, so I'd price it ₹14,500 — premium tier. It'll sell in about a week. Sound good?"

This is what an expert does.

### 6.4 What — multi-item per visit

After specialist submits one listing:

```
✓ Samsung Galaxy S22 listed at ₹14,500

What's next?

  [ Add another item (1/10 listed) ]

  [ Done with visit — capture seller signature ]
```

"Add another item" → resets capture form, stays in same visit.
"Done with visit" → close-visit flow (Phase 5 adds chain-of-custody photo here; for Phase 3 it just closes with `outcome: 'listed'`).

Cap: 10 items per visit.

### 6.5 What — seller approval at visit

Just before submit-listing API call fires, FE app shows confirmation screen:

```
Show this to Sunil before submitting.

  📱 Samsung Galaxy S22
     "Excellent" condition
     ₹14,500

  [ Sunil approved — list it ]
  [ Edit before listing ]
```

Specialist hands phone to seller. Seller reads, taps approve. Specialist takes phone back. API call fires.

This is the trust moment that reinforces "they're working FOR me, not on me."

### 6.6 How — backend

#### Endpoint: `GET /v1/listings/price-suggestion`

Query params: `category_id` (UUID, required), `brand` (string, required), `model` (string, optional), `condition` (string, optional).

```python
@router.get("/price-suggestion")
async def price_suggestion(
    db: DBSession,
    category_id: UUID,
    brand: str,
    model: Optional[str] = None,
    condition: Optional[str] = None,
    current_user: CurrentUser = Depends(),
) -> PriceSuggestionResponse:
    # FE-only access
    if current_user.role_type != 'fe' and current_user.role_type != 'admin':
        raise HTTPException(403)

    # Try exact match: category + brand + model + condition
    # If <5 matches, drop condition. If still <5, drop model.
    # If still <3, return null prices with message.

    base_filter = """
        l.category_id = :category_id
        AND l.brand ILIKE :brand_pattern
        AND t.status = 'completed'
        AND t.completed_at > NOW() - INTERVAL '60 days'
    """
    params = {
        "category_id": str(category_id),
        "brand_pattern": f"%{brand}%",
    }

    # Build progressively-loose filters
    filters_to_try = []
    if model and condition:
        filters_to_try.append((base_filter + " AND l.model ILIKE :model_pattern AND l.condition_grade = :condition", "exact"))
    if model:
        filters_to_try.append((base_filter + " AND l.model ILIKE :model_pattern", "category_brand_model"))
    filters_to_try.append((base_filter, "category_brand_only"))

    if model:
        params["model_pattern"] = f"%{model}%"
    if condition:
        params["condition"] = condition

    for filter_sql, quality in filters_to_try:
        result = await db.execute(text(f"""
            WITH matches AS (
                SELECT t.final_price_inr, t.completed_at, l.published_at
                FROM transactions t
                JOIN listings l ON l.id = t.listing_id
                WHERE {filter_sql}
                LIMIT 100
            )
            SELECT
                count(*) AS match_count,
                percentile_cont(0.25) WITHIN GROUP (ORDER BY final_price_inr) AS p25,
                percentile_cont(0.50) WITHIN GROUP (ORDER BY final_price_inr) AS median,
                percentile_cont(0.75) WITHIN GROUP (ORDER BY final_price_inr) AS p75,
                AVG(EXTRACT(EPOCH FROM (completed_at - published_at)) / 86400.0) AS avg_days
            FROM matches
        """), params)
        row = result.first()
        if row.match_count >= 5:
            return PriceSuggestionResponse(
                match_count=row.match_count,
                match_quality=quality,
                p25=int(row.p25),
                median=int(row.median),
                p75=int(row.p75),
                avg_days_to_sell=float(row.avg_days),
                suggested=int(row.median),
                faster_sell_price=int(row.p25 + (row.median - row.p25) * 0.5),
                premium_price=int(row.median + (row.p75 - row.median) * 0.5),
            )

    # No match
    return PriceSuggestionResponse(
        match_count=0,
        match_quality="no_match",
        p25=None, median=None, p75=None,
        avg_days_to_sell=None,
        suggested=None,
        faster_sell_price=None,
        premium_price=None,
    )
```

Schema:

```python
class PriceSuggestionResponse(BaseModel):
    match_count: int
    match_quality: str  # 'exact' | 'category_brand_model' | 'category_brand_only' | 'no_match'
    p25: Optional[int]
    median: Optional[int]
    p75: Optional[int]
    avg_days_to_sell: Optional[float]
    suggested: Optional[int]
    faster_sell_price: Optional[int]
    premium_price: Optional[int]
```

#### Update: `POST /v1/fe-visits/{id}/submit-listing`

Currently this endpoint may close the visit on submit. Change behavior:
- **Don't close the visit** on submit-listing. Keep visit `in_progress`.
- Track listing count per visit. If already 10 listings exist, return 400 "Max 10 items per visit. Close the visit and book another."

#### New endpoint: `POST /v1/fe-visits/{id}/close-visit`

```python
class CloseVisitRequest(BaseModel):
    outcome: str  # 'listed' | 'rejected_item' | 'seller_missing_verification' | 'pickup_not_ready'
    outcome_reason: Optional[str] = None
```

Behavior:
- Update `status = 'completed'`, set `outcome` and `outcome_reason`.
- Trigger earnings recording (existing pattern in `record_earning`).
- For Phase 3, no chain-of-custody photo. Phase 5 adds that.

### 6.7 How — mobile (FE app)

#### Update `FeVisitDetailScreen`

Show the pre-visit briefing layout from Section 6.2. Read `notes_tags` and `item_notes` from visit. Show verification code in subtle text.

#### Update `FeCaptureScreen`

Add the price-suggestion call. After brand + (optional model) + condition are filled:

```typescript
useEffect(() => {
  if (!brand || !categoryId) return;
  Listings.priceSuggestion({ categoryId, brand, model, condition })
    .then(setPriceSuggestion)
    .catch(() => setPriceSuggestion(null));
}, [brand, model, condition, categoryId]);
```

Render the panel above the price input. If `match_count == 0`, show: "No similar items in last 60 days. Use your judgment." instead of the panel.

#### Add seller-approval step

Just before the submit-listing call:

```typescript
const showApprovalScreen = () => {
  navigation.navigate('SellerApprovalScreen', {
    listing: { title, condition, price },
    onApprove: () => {
      Listings.submit(payload).then(handleSuccess);
    },
    onEdit: () => navigation.goBack(),
  });
};
```

`SellerApprovalScreen` is a simple full-screen modal with the layout from Section 6.5.

#### Multi-item flow

After `submit-listing` succeeds, instead of closing the visit, navigate to:

```typescript
navigation.replace('VisitContinueScreen', {
  visitId,
  listedCount: prevCount + 1,
});
```

`VisitContinueScreen` shows the layout from Section 6.4. Two buttons:
- "Add another item" → navigate back to FeCaptureScreen for same visit, reset form
- "Done with visit" → call `close-visit` endpoint with `outcome: 'listed'`, navigate to FeHomeScreen

### 6.8 Acceptance — Phase 3

1. Open FE app, see today's visit. Tap → see pre-visit briefing with tags, notes, verification code.
2. Tap "I've arrived." Verify code shown. (Phase 2 already wired the seller side.)
3. Open capture, pick category Smartphones, brand Samsung, model Galaxy S22, condition Excellent.
4. After model+condition entered, see expert pricing panel with median, range, quick-adjust chips.
5. Tap "Premium ₹14,500" — price input auto-fills.
6. Take 3 photos.
7. Tap submit → SellerApprovalScreen appears. Tap "Sunil approved — list it." Listing publishes.
8. Land on VisitContinueScreen. See "1/10 listed."
9. Tap "Add another item." Capture and submit a second item via approval flow. Verify both listings exist.
10. Try to submit 11th item — backend returns 400 "Max 10 items per visit."
11. Tap "Done with visit." Visit `status = 'completed'`, earnings recorded.

### 6.9 Phase 3 commit

```
git commit -m "Concierge Phase 3: pre-visit briefing + expert pricing + multi-item + seller approval"
git push origin main
```

**STOP. Wait for user acceptance before starting Phase 4.**

---

## 7. Phase 4 — Passive seller experience

**Goal:** A "My Concierge" timeline screen that shows everything happening with the seller's items, plus a payout transparency screen.

**Effort:** 1 day.

### 7.1 Why

After the visit, the seller does nothing for days/weeks. Without a unified view, they wonder if anything is happening. The timeline answers that.

### 7.2 What — `MyConciergeScreen`

Layout from Section 1 (Stage 5):

```
My Concierge

┌─────────────────────────────────────────┐
│ 🚚  Tuesday's Visit                     │
│     Vikram K. · 3 items listed          │
│                                          │
│  📱 Samsung Galaxy S22       ₹14,500    │
│     Listed Tue · Live · 8 watching       │
│                                          │
│  💻 Lenovo IdeaPad 3         ₹22,000    │
│     Listed Tue · Live · 3 watching       │
│                                          │
│  🎧 Sony WH-1000XM4          ₹8,500     │
│     ✓ SOLD Friday — ₹8,500              │
│     Vikram pickup tomorrow 11am-1pm      │
│     → Pay-out by Tuesday                 │
│                                          │
│  Pending earnings: ₹8,500                │
└─────────────────────────────────────────┘

[Older visits collapsed; tap to expand]
```

Each item row taps into existing `ListingDetailScreen` or `TransactionDetailScreen`.

If user has 0 visits: empty state with copy "You haven't booked a Concierge visit yet" + [Book a visit] CTA → SellModeForkScreen.

### 7.3 What — money-landed screen

When a transaction completes and seller's payout settles, the notification deep-links to:

```
✓ ₹8,415 credited

Sale: Sony WH-1000XM4

  Sold for          ₹8,500
  TDS deducted       -₹85
  ─────────────────────────
  Credited           ₹8,415

  Account: HDFC ····4789
  Transaction ID: TXN_2026_05_07_KJL93

  [View tax statement]
  [Sale details]
```

This is in existing `TransactionDetailScreen`. Extend to clearly show the breakdown if not already.

### 7.4 How — backend

#### Migration `0036_listing_visit_link.py` (if not already there)

Listings need to know which FE visit created them.

```python
def upgrade() -> None:
    op.add_column(
        'listings',
        sa.Column(
            'created_via_fe_visit_id',
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey('fe_visits.id', ondelete='SET NULL'),
            nullable=True,
        )
    )
    op.create_index(
        'ix_listings_created_via_fe_visit_id',
        'listings',
        ['created_via_fe_visit_id'],
    )

def downgrade() -> None:
    op.drop_index('ix_listings_created_via_fe_visit_id')
    op.drop_column('listings', 'created_via_fe_visit_id')
```

When `submit-listing` creates a listing, set `created_via_fe_visit_id = visit.id`.

Backfill where possible by matching `(seller_id, FE submission timestamp window)`. Best-effort.

#### No new endpoints

The screen pulls from existing endpoints:
- `GET /v1/fe-visits/me`
- `GET /v1/listings/me/listings` (filter by `created_via_fe_visit_id` clientside)
- `GET /v1/transactions`

If pagination or aggregation is needed, add a thin `/v1/users/me/concierge-summary` endpoint that returns the structured response.

### 7.5 How — mobile

#### `MyConciergeScreen.tsx`

Located at `mobile/src/screens/listings/concierge/MyConciergeScreen.tsx`.

Composes data:

```typescript
const { data: visits } = useQuery(['my-fe-visits'], FEVisits.myVisits);
const { data: myListings } = useQuery(['my-listings'], Listings.myListings);
const { data: transactions } = useQuery(['my-transactions'], Transactions.list);

const visitsWithDetails = visits?.map(visit => {
  const listings = myListings?.filter(l => l.created_via_fe_visit_id === visit.id) ?? [];
  const sales = transactions?.filter(t => listings.some(l => l.id === t.listing_id) && t.status === 'completed') ?? [];
  const pendingEarnings = sales.reduce((sum, t) => sum + (t.final_price_inr - t.tds_deducted_inr), 0);
  return { visit, listings, sales, pendingEarnings };
});
```

Render the layout from Section 7.2.

#### Profile menu entry

Add "My Concierge" as a top-level item in Profile menu (NOT nested under settings).

### 7.6 Acceptance — Phase 4

1. As a seller with at least one Concierge visit and 3 listed items (one sold), open Profile → My Concierge.
2. See visit card with all 3 items, correct statuses (Live, Live, SOLD).
3. Sold item shows pickup info and expected payout date.
4. Pending earnings sum is correct.
5. Tap any item → routes to listing or transaction detail.
6. Trigger a payout completion in dev. Receive money-landed notification. Tap → see clean payout breakdown with gross / TDS / net.

### 7.7 Phase 4 commit

```
git commit -m "Concierge Phase 4: passive seller timeline + payout transparency"
git push origin main
```

**STOP. Wait for user acceptance before starting Phase 5.**

---

## 8. Phase 5 — Trust safety net (failure modes)

**Goal:** Handle damage, disputes, no-shows, and quality concerns gracefully. Smallest user surface, highest stakes.

**Effort:** 1-2 days.

### 8.1 Item-receipt photos (chain of custody)

When specialist closes a visit, replace simple "Done with visit" flow:

#### FE app

```
Closing visit at Sunil's place

  Items being taken:

  ┌────────────────────────────────────┐
  │ 📱 Samsung Galaxy S22              │
  │ 💻 Lenovo IdeaPad 3                │
  │ 🎧 Sony WH-1000XM4                 │
  └────────────────────────────────────┘

  📷 Take a group photo of all items
     so seller has a record

  [Take photo]   [Skip — agreed verbally]

  Then:
  [✓ Sunil confirms items received by Owmee]
```

Photo uploaded via existing presigned-upload flow. Stored on visit.

#### Backend

Add to `fe_visits`:

```python
# Migration 0037_concierge_safety.py
op.add_column('fe_visits', sa.Column('handover_photo_r2_key', sa.String(500), nullable=True))
op.add_column('fe_visits', sa.Column('handover_skipped', sa.Boolean(), server_default='false'))
op.add_column('fe_visits', sa.Column('seller_handover_confirmed_at', sa.DateTime(timezone=True), nullable=True))
```

Update close-visit endpoint to accept optional `handover_photo_r2_key` and `handover_skipped`.

#### Mobile (seller)

Push: "📋 Visit complete — see your receipt"

Receipt screen pulls handover photo + listed items + specialist signature (just specialist name + timestamp).

### 8.2 "Report issue" flow

In `FeCaptureScreen` and `FeVisitDetailScreen`, add subtle "Report issue" button (top-right corner).

Modal with categorized reasons:

```
Report an issue

  ⚠️ Item is damaged / not as described
  ⚠️ Seller wants to back out
  ⚠️ Address doesn't match
  ⚠️ Seller not present
  ⚠️ Safety concern (urgent)
  ⚠️ Other

  [Continue]
```

Each option opens a tailored secondary form. Submitting creates `fe_visit_issue` row.

#### Backend

```python
# Migration 0038_fe_visit_issues.py
op.create_table(
    'fe_visit_issues',
    sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column('visit_id', sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey('fe_visits.id'), nullable=False),
    sa.Column('reporter_user_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('category', sa.String(50), nullable=False),
    sa.Column('severity', sa.String(20), nullable=False),  # 'low' | 'medium' | 'high' | 'urgent'
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('photo_urls', sa.JSON(), server_default='[]'),
    sa.Column('admin_notified_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('admin_resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('admin_resolution_notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
)
```

`POST /v1/fe-visits/{id}/issues` (FE-side) and `POST /v1/users/me/visit-issues` (seller-side via the "Code didn't match" path from Phase 2).

`severity == 'urgent'`: trigger admin web alert + optional Slack/Discord webhook (env-driven; off by default).

In admin web, add `/admin/fe-issues` listing page filtered by severity.

### 8.3 Damage protection (transit damage payout)

When admin resolves a dispute as "transit damage, not seller's fault":
- Buyer gets full refund (existing flow)
- Seller gets full expected payout from "trust fund" sub-ledger (Owmee absorbs)
- Specialist NOT penalized

Add to admin web dispute resolution page: button "Protect seller (transit damage)" alongside existing "Refund buyer" / "Release to seller."

#### Backend logic

In refund/dispute service, add a new resolution path:

```python
async def resolve_with_seller_protection(db, dispute, transaction):
    # Refund buyer fully
    await refund_service.process_refund(db, transaction, ...)

    # Mark seller payout as "trust fund payable"
    await db.execute(text("""
        UPDATE transactions
        SET trust_fund_payout_amount_inr = expected_payout_inr,
            seller_protection_reason = 'transit_damage',
            seller_protection_resolved_at = now()
        WHERE id = :txn_id
    """), {"txn_id": str(transaction.id)})

    # Manual finance ops settles trust_fund payouts monthly
```

Migration adds `trust_fund_payout_amount_inr`, `seller_protection_reason`, `seller_protection_resolved_at` columns to `transactions`.

### 8.4 Specialist NPS

After every completed-and-paid-out visit, send a 1-question NPS push:

```
"Quick question — how was your visit with Vikram?"
```

Tapping opens:

```
How was your visit?

Would you recommend Vikram to a friend?

[0] [1] [2] [3] [4] [5] [6] [7] [8] [9] [10]

← Not at all              Definitely →

(Optional) What made it good or bad?
[ Free text ]

[Submit]
```

#### Backend

```python
# Migration 0039_fe_visit_nps.py
op.create_table(
    'fe_visit_nps',
    sa.Column('id', sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
    sa.Column('visit_id', sa.dialects.postgresql.UUID(as_uuid=True), sa.ForeignKey('fe_visits.id'), unique=True),
    sa.Column('seller_user_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('specialist_user_id', sa.dialects.postgresql.UUID(as_uuid=True), nullable=False),
    sa.Column('nps_score', sa.SmallInteger(), nullable=False),
    sa.Column('free_text', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
)
```

Aggregate: each specialist's rolling 30-day NPS. Show in admin web specialist detail. Alert if drops below 50.

### 8.5 Acceptance — Phase 5

1. As specialist, complete a visit. Verify "Take a photo of items" prompt before close. Take photo, confirm. Visit closes.
2. As seller, receive receipt notification. Tap → see receipt with items, photo, specialist signature.
3. As specialist, trigger issue report — pick "Item damaged." Submit with photo. Verify `fe_visit_issues` row created with severity 'medium'.
4. Trigger urgent issue (safety concern). Verify admin web shows alert.
5. Manually run a transaction through dispute → admin action "Protect seller (transit damage)." Verify buyer refunded, transaction has `trust_fund_payout_amount_inr` set.
6. After completed visit + payout, seller gets NPS push. Submit a 9. Verify recorded in `fe_visit_nps`.

### 8.6 Phase 5 commit

```
git commit -m "Concierge Phase 5: chain of custody + issue reporting + damage protection + NPS"
git push origin main
```

---

## 9. Post-implementation cleanup

After Phase 5 ships:

1. Delete `mobile/src/screens/listings/RequestFeVisitScreen.tsx` (deprecated in Phase 1).
2. Update `PILOT_READINESS.md`:
   - Move "Push notifications mobile-side" to Shipped (covered by Phase 2).
   - Add "Owmee Concierge (5 phases)" to Shipped section.
3. Update `CLAUDE.md` to reference this consolidated spec at `docs/CONCIERGE_MASTER_SPEC.md`.
4. Update `KNOWN_ISSUES.md` with anything that surfaced.

---

## 10. Strings & copy reference (single source)

All seller-facing copy lives in `mobile/src/utils/conciergeStrings.ts`. Section 4.6 has Phase 1 strings. Phases 2-5 add to the same file. **Don't hard-code seller-facing strings in screen code** — copy must be editable without engineering.

Specialist-facing copy in FE app can be inline (it's internal).

---

## 11. Locked decisions reminder (for the Claude Code session)

- **Naming:** "Owmee Concierge" + "Owmee Specialist" in seller copy. Internal code keeps "FE."
- **Pricing:** ₹0 everything in pilot. No mention of fees in booking.
- **Phasing:** Strict 1 → 2 → 3 → 4 → 5. Each phase ships standalone.
- **Premium feel:** Non-negotiable. Trust theater + expert pricing + passive timeline are core, not optional.
- **Booking flow:** ONE screen with two required fields (address + slot) and one optional field (notes). NOT a 3-step wizard.
- **Free-text + tags > structured cohort buckets.** At pilot scale (100 visits), reading notes teaches more than analytics dashboards.

---

## 12. Risks & mitigations

### Risk 1: Concierge bookings flood ops capacity

If Phase 1's fork-screen positioning works, you may get more bookings than 3 specialists can handle. Specialist visits take 60-90 minutes each. 3 specialists × 4 visits/day = 12 visits/day cap.

**Mitigation:** add a max-bookings-per-day backend cap. When booking attempts exceed cap, show "We're booked for the next week — we'll email when slots open."

### Risk 2: Specialist quality varies wildly

Three specialists deliver three quality levels. Variance kills word-of-mouth.

**Mitigation:** Founder accompanies first 5 visits per specialist. Document "great" in writing. Each new specialist's first 3 visits co-shadowed by experienced one.

### Risk 3: Specialist accepts cash off-platform

Sounds harmless. Becomes corruption.

**Mitigation:** Train policy clearly. Random WhatsApp/SMS audits with sellers post-visit. Any cash transaction = immediate termination.

### Risk 4: Item damage in transit

Liability claims, refund disputes, churn of trust.

**Mitigation:** Phase 5's damage protection. Owmee absorbs up to ₹5,000 per dispute without escalation. Trust-fund budget tracked monthly.

### Risk 5: FCM not shipping in time for Phase 2

Phase 2 trust theater depends on push notifications.

**Mitigation:** ship FCM mobile wiring as a standalone task BEFORE Concierge Phase 2 starts. Don't bundle (high risk of partial-ship). If FCM slips, Phase 2 can ship with in-app banners as fallback — degraded but not blocking.

### Risk 6: Spec drift between phases

Five phases, ~10 days of work, multiple Claude Code sessions. Easy for naming/conventions to drift.

**Mitigation:** the strings file. The internal-vs-user-facing naming rules. The `conciergeStrings.ts` single-source pattern. Each phase's commit message references this master spec.

---

## 13. Out of scope (do not build)

- Subscription tiers
- Voice/video listings
- AI pricing beyond SQL aggregation
- Cross-city expansion logic
- Specialist incentive structures (ops decision)
- Buyer-side experience changes
- Real Razorpay live testing
- Real Digio KYC integration
- iOS-first features
- Specialist re-rating beyond NPS
- "Refer a friend" flow
- Multi-language address forms

These are tracked elsewhere (PILOT_READINESS.md, deferred backlog). Do not mix into Concierge work.

---

## 14. Final note before starting

This is the make-or-break feature for Owmee. The pilot's success depends on it.

If uncertain about any UI detail, ask before guessing.
If a phase needs more time to do right, tell the user — don't ship degraded.
Show `git diff main` before each push.

The user has explicitly stated:
- Premium feel is non-negotiable
- Trust theater is mandatory
- Booking should be light, not 3 pages
- All five phases should ship to flagship quality

Don't compromise on any of those.
