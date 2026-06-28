from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.main import create_app
from app.modules.field_executive import service
from app.modules.field_executive.router import _normalize_india_phone
from app.modules.identity_auth.router import _resolve_role


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _DB:
    def __init__(self, value):
        self.value = value

    async def execute(self, *_args, **_kwargs):
        return _Result(self.value)


def _fe(**overrides):
    base = dict(
        id=uuid4(),
        user_id=uuid4(),
        fe_code="FE-BLR-001",
        city="Bengaluru",
        active=False,
        current_shift="off",
        onboarding_status="candidate",
        verification_status="pending",
        training_status="not_started",
        device_status="not_bound",
        employment_type="contractor",
        vendor_name=None,
        service_zones=[],
        category_certifications=[],
        languages=[],
        daily_capacity=4,
        profile_snapshot={},
        onboarding_checklist={},
        device_binding={},
        risk_metrics={},
        verified_at=None,
        certified_at=None,
        device_approved_at=None,
        activated_at=None,
        suspended_at=None,
        suspended_reason=None,
        last_seen_at=None,
        shift_started_at=None,
        shift_location={},
        admin_notes=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_fe_onboarding_routes_are_registered():
    paths = create_app().openapi()["paths"]

    required = {
        "/v1/fe/onboarding/me",
        "/v1/fe/onboarding/device",
        "/v1/fe/onboarding/shift/check-in",
        "/v1/fe/onboarding/shift/check-out",
        "/v1/admin/fe-visits/fes/{fe_id}",
        "/v1/admin/fe-visits/fes/{fe_id}/verification",
        "/v1/admin/fe-visits/fes/{fe_id}/training",
        "/v1/admin/fe-visits/fes/{fe_id}/device",
        "/v1/admin/fe-visits/fes/{fe_id}/activate",
        "/v1/admin/fe-visits/fes/{fe_id}/suspend",
        "/v1/admin/fe-visits/fes/{fe_id}/deactivate",
    }
    missing = sorted(required - set(paths))
    assert not missing


def test_admin_fe_invite_phone_normalization_is_strict():
    assert _normalize_india_phone("8095918925") == "+918095918925"
    assert _normalize_india_phone("91 8095918925") == "+918095918925"
    assert _normalize_india_phone("+91-8095918925") == "+918095918925"

    with pytest.raises(HTTPException):
        _normalize_india_phone("12345")


def test_candidate_fe_has_explicit_readiness_gaps_and_cannot_be_assigned():
    fe = _fe()

    gaps = service.readiness_gaps(fe)

    assert "verification_not_approved" in gaps
    assert "training_not_certified" in gaps
    assert "device_not_approved" in gaps
    assert "service_zones_missing" in gaps
    assert "category_certification_missing" in gaps
    with pytest.raises(service.FEOnboardingError) as exc:
        service.assert_fe_ready_for_assignment(fe)
    assert exc.value.code == "FE_INACTIVE"


def test_legacy_active_fe_remains_assignable_after_migration_defaults():
    fe = SimpleNamespace(active=True, current_shift="off")

    assert service.readiness_gaps(fe) == []
    service.assert_fe_ready_for_assignment(fe, required_categories={"toys"})


def test_admin_can_activate_only_after_all_required_checks_are_complete():
    fe = _fe(
        verification_status="approved",
        training_status="certified",
        device_status="approved",
        service_zones=["Bengaluru"],
        category_certifications=["toys", "books"],
    )

    service.activate_fe(fe)

    assert fe.active is True
    assert fe.onboarding_status == "active"
    service.assert_fe_ready_for_assignment(fe, required_categories={"toys"})


def test_category_certification_blocks_wrong_direct_or_visit_assignment():
    fe = _fe(
        active=True,
        onboarding_status="active",
        verification_status="approved",
        training_status="certified",
        device_status="approved",
        service_zones=["Bengaluru"],
        category_certifications=["books"],
    )

    with pytest.raises(service.FEOnboardingError) as exc:
        service.assert_fe_ready_for_assignment(fe, required_categories={"toys"})

    assert exc.value.code == "FE_CATEGORY_NOT_CERTIFIED"


def test_device_rebind_deactivates_fe_until_admin_reapproves():
    fe = _fe(
        active=True,
        onboarding_status="active",
        verification_status="approved",
        training_status="certified",
        device_status="approved",
        service_zones=["Bengaluru"],
        category_certifications=["*"],
        device_binding={"device_id": "old-phone"},
    )

    service.request_device_binding(fe, {"device_id": "new-phone", "platform": "android"})

    assert fe.active is False
    assert fe.device_status == "pending_admin_approval"
    assert fe.device_binding["previous_device_id"] == "old-phone"
    with pytest.raises(service.FEOnboardingError) as exc:
        service.assert_fe_ready_for_assignment(fe)
    assert exc.value.code == "FE_INACTIVE"


def test_suspension_blocks_shift_and_assignment_until_admin_acts():
    fe = _fe(
        active=True,
        onboarding_status="active",
        verification_status="approved",
        training_status="certified",
        device_status="approved",
        service_zones=["Bengaluru"],
        category_certifications=["*"],
    )

    service.suspend_fe(fe, "seller complaint under review")

    assert fe.active is False
    assert fe.current_shift == "blocked"
    assert fe.onboarding_status == "suspended"
    with pytest.raises(service.FEOnboardingError):
        service.assert_fe_ready_for_assignment(fe)


def test_terminal_fe_cannot_bind_device_from_mobile():
    fe = _fe(onboarding_status="deactivated")

    with pytest.raises(service.FEOnboardingError) as exc:
        service.request_device_binding(fe, {"device_id": "phone-1"})

    assert exc.value.code == "FE_NOT_OPERATIONAL"


@pytest.mark.asyncio
async def test_token_role_allows_non_terminal_fe_onboarding_but_not_rejected_profiles():
    user_id = uuid4()

    assert await _resolve_role(_DB("candidate"), user_id) == "fe"
    assert await _resolve_role(_DB("suspended"), user_id) == "fe"
    assert await _resolve_role(_DB("active"), user_id) == "fe"
    assert await _resolve_role(_DB("rejected"), user_id) == "user"
    assert await _resolve_role(_DB("deactivated"), user_id) == "user"
    assert await _resolve_role(_DB(None), user_id) == "user"
