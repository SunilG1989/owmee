# Hero Image Background Cleanup

Owmee cleans only the hero image during AI listing analysis. The current flow is
synchronous inside `/v1/listings/draft/from-images` and the legacy
`/v1/listings/draft/from-image` endpoint:

1. Store every seller photo as durable originals and WebP display variants.
2. Run AI product detection across the uploaded photos.
3. Select one hero image.
4. Send only that hero image to the background-cleanup provider.
5. Store the cleaned hero as a new display/thumbnail variant.
6. Save the cleaned hero first in the draft/listing gallery.

This means the seller preview and buyer listing do not wait for a later worker
to update the photo. If cleanup fails, Owmee falls back to the original processed
photo and still keeps the listing flow working.

## Background Policy

The default background is consistent across listings:

- `owmee_warm_ivory`: warm ivory studio background with a subtle eucalyptus
  green wash, matte finish, and natural contact shadow.

Only switch background style when the centered product color would blend into
the default background:

- Light/white/cream/silver product: use `owmee_soft_sage_contrast`.
- Green/teal/blue product: use `owmee_soft_burnt_orange_contrast`.
- Orange/copper/brown product: use `owmee_soft_eucalyptus_contrast`.

The product is never recolored for contrast. Only the background shade changes.

## Product Preservation Rules

The provider prompt explicitly forbids changing product shape, color, material,
texture, labels, logos, scratches, dents, cracks, stickers, accessories,
perspective, or visible defects. Originals always remain stored for buyer trust,
moderation, and dispute review.

## Edge Cases Covered

- Product color close to standard background.
- White/cream products disappearing on ivory.
- Green products disappearing on the green-tinted Owmee background.
- Orange/copper products clashing with warm background accents.
- Provider failure or missing API key.
- Legacy single-photo clients.
- Multi-photo clients where the AI-selected hero is not the first uploaded
  image.
- Old stored signed URLs expiring in production.
