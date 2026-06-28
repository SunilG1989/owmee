# Listing Category Requirements

Owmee launch categories stay intentionally small:

- `smartphones`
- `laptops`
- `tablets`
- `small-appliances`
- `kids-utility`
- `others`

Buyer trust, however, depends on a richer review contract than category alone.
The app therefore derives a lightweight `category_family` at review/publish time:

- `device`: smartphones, laptops, tablets
- `appliance`: small/home appliances, even when originally detected under `others`
- `toy`: toys, baby gear, kids utility, games, puzzles, learning kits
- `book`: books, textbook sets, workbooks, comics, flashcards, reading sets
- `other`: sellable items that do not fit the launch families

This family layer is deterministic and local. It does not add another LLM call,
database category, cache, or migration.

## Architecture

1. Gemini returns the launch `category_slug`, optional `category_family`, and
   `category_specifics` when visible from photos.
2. Backend canonicalizes `category_slug` and re-derives `category_family` using
   `backend/app/modules/ai_assistant/category_taxonomy.py`.
3. Backend returns `analysis_contract.smart_review` with P0/P1 metadata:
   `value`, `source`, `confidence`, `required_level`, `status`, and
   `confirmation_required`.
4. Mobile AI review renders a one-page smart review: buyer preview, readiness
   card, and a required-check queue containing only missing or risky P0 fields.
5. Seller confirms required facts before publishing.
6. Backend validates the same contract in `POST /v1/listings/from-draft`.
7. Confirmed fields are stored in `listings.seller_review_snapshot`, under
   `seller_confirmed.category_family` and `seller_confirmed.category_specifics`.

## P0 / P1 Contract

P0 blocks publish when missing:

- Photos.
- Category.
- Title.
- Asking price.
- Condition.
- Major defect / missing-parts / safety disclosure.
- Pickup locality and fulfilment method.
- Category-specific required attributes.
- Working status when relevant.

P1 never blocks publish:

- AI description.
- Brand unless the category truly needs it.
- Material.
- Box included.
- Invoice upload.
- Purchase year.
- Extra notes or extra photos.
- Original price / MRP.

P0 values can be AI-filled or system-filled, but the review page must keep them
visible. Low-confidence or high-risk P0 values require seller confirmation.
Vague negative disclosures such as “defects disclosed”, “notes/highlights
disclosed”, or “missing parts disclosed” also require a buyer-facing detail.
Clear safe values such as “no known defects” or “no parts missing” should not
create extra work for the seller.

## Universal Requirements

Every publishable listing needs:

- Minimum 3 clear product photos.
- One sellable product only.
- No private information, faces, documents, cards, chats, UPI IDs, or stock-only images.
- Specific title.
- Category.
- Condition.
- Asking price.
- Honest disclosure for visible defects.

## Devices

Applies to smartphones, laptops, and tablets.

Required before publish:

- Brand.
- Model.
- Storage.
- RAM for laptops.
- Box present: yes/no.
- Bill present: yes/no.
- Charger present: yes/no.
- Earphones for phones: yes/no.
- Water damage history: yes/no.
- Seller functional attestation: yes/no.
- Screen and body condition.
- IMEI for smartphones.
- Serial/service tag for laptops and tablets.

Negative disclosures are allowed. For example, “No charger” or “water damaged”
can publish if the seller explicitly confirms it.

## Toys And Kids Utility

Applies to toys, games, puzzles, LEGO/blocks, baby gear, strollers, ride-on toys,
learning kits, and similar kids items.

Required before publish:

- Age suitability.
- Cleanliness/hygiene status.
- Parts completeness.
- Safety status.
- Kids safety checklist for small parts, loose batteries, and sharp edges.
- Battery/working status when the item appears powered, remote-controlled,
  electronic, musical, ride-on, or tablet-like.

Positive examples:

- `missing_parts_status = Complete / no parts missing`
- `safety_status = No visible safety issue`
- `working_status = Works as expected`

Allowed negative examples:

- `missing_parts_status = Minor missing parts disclosed`
- `safety_status = Issue disclosed`
- `working_status = Not tested`

Blocked cases:

- Seller skips age or hygiene.
- Seller skips safety or missing-parts disclosure.
- Powered toy has no battery/working disclosure.
- Kids checklist is absent.

## Books And Study Material

Applies to books, textbooks, comics, workbooks, flashcards, reading sets, and
school learning material. Books can be classified under `kids-utility` or
`others`, but the requirement family becomes `book`.

Required before publish:

- Book type.
- Language.
- Page condition.
- Markings/highlights status.
- Page completeness.
- Set completeness when it is a set, series, box, bundle, or combo.
- Exact class, board, or edition detail when the item is a textbook, workbook,
  school guide, or class/board study material. Placeholder values such as
  “shown”, “visible”, or “not sure” do not satisfy this gate.

Allowed negative examples:

- `page_condition = Some tears disclosed`
- `markings_status = Heavy markings`
- `pages_complete = Missing pages disclosed`
- `set_status = Partial set disclosed`

Blocked cases:

- No language.
- No page/marking disclosure.
- Set or series without set completeness.
- Educational book without class/board/edition detail.

## Home Appliances

Applies to small appliances and home appliances such as air fryers, mixers,
microwaves, washing machines, refrigerators, geysers, purifiers, vacuums,
chimneys, fans, irons, and similar items.

Required before publish:

- Appliance type.
- Working status.
- Accessories/attachments status.
- Defect disclosure.
- Pickup complexity for bulky or installation-heavy appliances such as washing
  machines, refrigerators, ACs, geysers, chimneys, and dishwashers.
- Power or installation status for the same bulky/install-heavy appliances.

Allowed negative examples:

- `working_status = Partially working`
- `working_status = Not tested`
- `accessories_status = Some accessories missing`
- `defects_disclosed = Defects disclosed`
- `pickup_complexity = Needs disconnection/install help`

Blocked cases:

- No working status.
- No accessory status.
- No defect disclosure.
- Bulky appliance without pickup complexity.
- Bulky appliance without power/installation expectation.

## Smart Review UX

The AI review page remains one page. It is not a long form.

- Header: `Review listing` with helper copy saying Owmee filled the draft from
  photos.
- Buyer preview: main photo, title, price, category, condition, locality, and
  fulfilment signals are always visible.
- Readiness card: shows remaining P0 count and expected completion time.
- Required checks: shows only missing or confirmation-needed P0 fields.
- Optional details: stay secondary and never block publish.
- Sticky CTA: `Complete required checks` until P0 is done, then `Publish`.

Quick checks use small option sets, usually 3 to 5 choices. Free text appears
only when a negative disclosure needs explanation or when the buyer-critical
value must be exact, such as class/board/edition for educational books.

## Performance Rules

- Do not add another Gemini call for category requirements.
- Do not block initial draft readiness on deep enrichment.
- Use local deterministic rules for mobile UI and backend validation.
- Keep requirement options as small arrays and memoized derived values.
- Persist the seller-confirmed snapshot once, during publish.

## Success Metrics

- Median review-to-publish time below 60 seconds.
- P80 review-to-publish time below 120 seconds.
- Required-check completion rate above 90%.
- Manual text entry near zero for standard toys, books, and appliances.
- Lower dispute/mismatch rate for condition, missing parts, and working status.

## Future Backlog

- Show category-specific facts more prominently on seller inventory pages.
- Use category-specific facts as price-adjustment signals.
- Add FE-assisted parity for book/appliance-specific requirements.
- Expand category family detection only when new launch categories are approved.
