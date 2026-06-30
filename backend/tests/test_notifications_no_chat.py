"""Regression tests for Owmee's no-chat notification contract."""
import inspect

from app.modules.notifications.service import BUCKET_MAP, push
from app.modules.offers.router import NotificationPreferencesRequest


def test_notification_events_do_not_route_to_message_bucket():
    assert "messages" not in set(BUCKET_MAP.values())
    assert "new_message" not in BUCKET_MAP
    assert "meetup_confirmed" not in BUCKET_MAP


def test_notification_preferences_hide_legacy_messages_field():
    prefs = NotificationPreferencesRequest.model_validate({
        "transactions_enabled": False,
        "messages_enabled": False,
        "promotions_enabled": True,
    })

    assert not hasattr(prefs, "messages_enabled")
    assert prefs.transactions_enabled is False
    assert prefs.promotions_enabled is True


def test_push_can_skip_duplicate_in_app_persistence():
    signature = inspect.signature(push)

    assert "persist_in_app" in signature.parameters
    assert signature.parameters["persist_in_app"].default is True
    assert "idempotency_key" in signature.parameters


def test_core_ops_notification_events_are_transaction_bucket():
    for event in {
        "fe_pickup_assigned",
        "fe_return_pickup_assigned",
        "fe_delivery_assigned",
        "fe_visit_assigned",
        "refund_completed",
        "refund_completed_seller",
        "fe_onboarding_created",
        "fe_verification_updated",
        "fe_training_updated",
        "fe_device_updated",
        "fe_activated",
        "fe_suspended",
        "fe_deactivated",
    }:
        assert BUCKET_MAP[event] == "transactions"
