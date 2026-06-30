from types import SimpleNamespace

from app.core.admin_dependencies import ADMIN_ROLE_DEFINITIONS, ADMIN_ROLES
from app.modules.admin.ops_control import build_provider_health


def _config(**overrides):
    base = {
        "sms_provider": "msg91",
        "sms_api_key": "msg91-key",
        "sms_template_id": "1207-template",
        "sms_sender_id": "OWMOTP",
        "sms_dlt_entity_id": "1201-entity",
        "pa_provider": "razorpay",
        "pa_key_id": "rzp_test_key",
        "pa_key_secret": "rzp_secret",
        "pa_webhook_secret": "whsec",
        "ai_provider": "gemini",
        "gemini_api_key": "gemini-key",
        "gemini_vision_model": "gemini-3-flash-preview",
        "gemini_text_model": "gemini-3-flash-preview",
        "r2_endpoint": "https://r2.example",
        "r2_access_key": "r2-access",
        "r2_secret_key": "r2-secret",
        "r2_public_url": "https://media.example",
        "fraud_provider": "bureau",
        "fraud_api_base_url": "https://fraud.example",
        "fraud_api_key": "fraud-key",
        "fraud_enforcement_enabled": True,
        "kyc_partner": "digio",
        "kyc_partner_api_key": "kyc-key",
        "kyc_partner_base_url": "https://kyc.example",
        "kyc_webhook_secret": "kyc-whsec",
        "push_provider": "fcm",
        "fcm_server_key": "fcm-key",
        "geocoding_provider": "photon",
        "photon_url": "https://photon.example",
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_provider_health_reports_all_ok_when_launch_integrations_are_configured():
    health = build_provider_health(_config())

    assert {item.service for item in health} == {
        "OTP SMS",
        "Payments",
        "AI listing analysis",
        "Media storage",
        "Fraud checks",
        "KYC",
        "Push notifications",
        "Geocoding",
    }
    assert all(item.status == "ok" for item in health)
    assert all(not item.missing for item in health)


def test_provider_health_blocks_missing_launch_critical_integrations():
    health = build_provider_health(_config(
        sms_api_key="",
        sms_template_id="REPLACE_WITH_TEMPLATE",
        pa_key_secret="",
        pa_webhook_secret="",
        gemini_api_key="",
        r2_public_url="",
        fcm_server_key="",
    ))
    by_service = {item.service: item for item in health}

    assert by_service["OTP SMS"].status == "blocked"
    assert by_service["OTP SMS"].missing == ["SMS_API_KEY", "SMS_TEMPLATE_ID"]
    assert by_service["Payments"].status == "blocked"
    assert by_service["Payments"].missing == ["PA_KEY_SECRET", "PA_WEBHOOK_SECRET"]
    assert by_service["AI listing analysis"].status == "blocked"
    assert by_service["AI listing analysis"].missing == ["GEMINI_API_KEY"]
    assert by_service["Media storage"].status == "blocked"
    assert by_service["Media storage"].missing == ["R2_PUBLIC_URL"]
    assert by_service["Push notifications"].status == "blocked"


def test_provider_health_flags_dev_fraud_when_enforcement_is_enabled():
    health = build_provider_health(_config(
        fraud_provider="mock",
        fraud_api_base_url="",
        fraud_api_key="",
        fraud_enforcement_enabled=True,
    ))
    fraud = next(item for item in health if item.service == "Fraud checks")

    assert fraud.status == "blocked"
    assert fraud.launch_blocker is True
    assert fraud.missing == []


def test_admin_role_map_covers_launch_ops_roles_without_losing_legacy_roles():
    expected = {
        "L1_AGENT",
        "L1_SUPPORT",
        "OPS_DISPATCHER",
        "FE_MANAGER",
        "LISTING_REVIEWER",
        "WAREHOUSE_OPS",
        "L2_REVIEWER",
        "FINANCE_OPS",
        "RISK_ANALYST",
        "OPS_MANAGER",
        "SUPER_ADMIN",
    }

    assert expected.issubset(ADMIN_ROLES)
    for role in expected:
        definition = ADMIN_ROLE_DEFINITIONS[role]
        assert definition["label"]
        assert definition["description"]
        assert definition["capabilities"]
