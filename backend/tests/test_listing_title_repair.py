from app.modules.listings.title_repair import plan_existing_listing_title_repair


def test_repairs_other_pink_pencil_box_title_model_and_snapshot():
    snapshot = {
        "seller_confirmed": {
            "title": "Other Pink",
            "model": "Other",
            "category_family": "toy",
            "category_specifics": {
                "toy_type": "Other",
                "missing_parts_status": "Complete",
            },
        }
    }

    plan = plan_existing_listing_title_repair(
        {
            "id": "listing-1",
            "title": "Other Pink",
            "description": "Cute pink magnetic pencil box featuring a unicorn design.",
            "model": "Other",
            "category_slug": "kids-utility",
            "seller_review_snapshot": snapshot,
        }
    )

    assert plan is not None
    assert plan.new_title == "Pink magnetic pencil box"
    assert plan.new_model == "Pink magnetic pencil box"
    assert plan.category_family == "toy"
    assert plan.new_category_specifics["toy_type"] == "pink magnetic pencil box"
    assert plan.new_category_specifics["missing_parts_status"] == "Complete"
    confirmed = plan.seller_review_snapshot["seller_confirmed"]
    assert confirmed["title"] == "Pink magnetic pencil box"
    assert confirmed["model"] == "Pink magnetic pencil box"
    assert confirmed["category_specifics"]["toy_type"] == "pink magnetic pencil box"
    assert plan.seller_review_snapshot["maintenance_repairs"]["generic_title_backfill"]["old_title"] == "Other Pink"


def test_repairs_other_camouflage_from_description():
    plan = plan_existing_listing_title_repair(
        {
            "id": "listing-2",
            "title": "Other camouflage",
            "description": "Toy binoculars with a camouflage pattern are visible.",
            "model": "Other",
            "category_slug": "kids-utility",
            "seller_review_snapshot": {
                "seller_confirmed": {
                    "title": "Other camouflage",
                    "model": "Other",
                    "category_specifics": {"toy_type": "Other"},
                }
            },
        }
    )

    assert plan is not None
    assert plan.new_title == "Toy binoculars"
    assert plan.new_model == "Toy binoculars"
    assert plan.new_category_specifics["toy_type"] == "toy binoculars"


def test_uses_existing_concrete_category_specific_type_before_description():
    plan = plan_existing_listing_title_repair(
        {
            "title": "Other Green",
            "description": "Good condition and ready to sell.",
            "model": "Other",
            "category_slug": "small-appliances",
            "seller_review_snapshot": {
                "seller_confirmed": {
                    "category_family": "appliance",
                    "category_specifics": {
                        "appliance_type": "mixer grinder",
                        "working_status": "Working",
                    },
                }
            },
        }
    )

    assert plan is not None
    assert plan.new_title == "Mixer grinder"
    assert plan.new_model == "Mixer grinder"
    assert plan.new_category_specifics["appliance_type"] == "mixer grinder"
    assert plan.new_category_specifics["working_status"] == "Working"


def test_skips_good_title():
    plan = plan_existing_listing_title_repair(
        {
            "title": "Wooden stacking toy",
            "description": "Wooden stacking toy with rings.",
            "model": "Wooden stacking toy",
            "category_slug": "kids-utility",
        }
    )

    assert plan is None


def test_skips_generic_title_when_no_safe_candidate_exists():
    plan = plan_existing_listing_title_repair(
        {
            "title": "Other Good",
            "description": "Good condition. Seller confirmed details.",
            "model": "Other",
            "category_slug": "others",
            "seller_review_snapshot": {"seller_confirmed": {"category_specifics": {}}},
        }
    )

    assert plan is None


def test_does_not_create_snapshot_for_manual_listing_without_snapshot():
    plan = plan_existing_listing_title_repair(
        {
            "title": "Other Red",
            "description": "Water bottle with screw cap.",
            "model": "Other",
            "category_slug": "others",
        }
    )

    assert plan is not None
    assert plan.new_title == "Water bottle"
    assert plan.new_model == "Water bottle"
    assert plan.seller_review_snapshot is None
