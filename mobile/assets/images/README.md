# Owmee — Bundled Image Assets

Drop PNG / JPG product imagery here and the home screen will pick them up
via `require()` in CategoryRail.tsx and HeroCard.tsx.

## Required files (the components are wired to read these exact names)

### Categories — square, 200×200, transparent or white-bg PNG
- `category-mobiles.png`     (smartphone product shot)
- `category-laptops.png`     (laptop product shot)
- `category-kids.png`        (toy / kids product shot)
- `category-books.png`       (books stack)
- `category-appliances.png`  (washing machine / appliance shot)

### Hero slides — landscape, 1200×600, lifestyle photography
- `hero-trust.png`     (luxury shopping / inspected items vibe)
- `hero-sell.png`      (clean product flat-lay / sell-from-home)
- `hero-doorstep.png`  (delivery / package / handover)

### Recommended sources (free, premium-looking)
- icons8.com/icons/3d (3D product icon packs — closest to final.png aesthetic)
- flaticon.com (curated icon packs)
- iconscout.com (3D + lottie)
- storyset.com (free editorial illustrations)
- unsplash.com (download HD photos and bundle)

## After you drop the files

Just reload the app — components are already wired to `require('./assets/images/category-laptops.png')`.
No code changes needed.
