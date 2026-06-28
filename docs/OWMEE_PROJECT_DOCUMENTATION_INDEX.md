# Owmee Project Documentation Index

This index points to the current project-level architecture and E2E design
documents. The Markdown files are the editable sources. The matching PDFs are
generated into `output/pdf/` so they can be shared or downloaded without opening
the repo.

## Primary Documents

| Document | Source | Downloadable PDF |
| --- | --- | --- |
| System Architecture and Design | `docs/OWMEE_SYSTEM_ARCHITECTURE_AND_DESIGN.md` | `output/pdf/owmee_system_architecture_and_design.pdf` |
| E2E Product and Operations Flow Design | `docs/OWMEE_E2E_PRODUCT_AND_OPERATIONS_FLOW_DESIGN.md` | `output/pdf/owmee_e2e_product_and_operations_flow_design.pdf` |
| Operations, Integrations, and Launch Readiness | `docs/OWMEE_OPERATIONS_INTEGRATIONS_AND_LAUNCH_READINESS.md` | `output/pdf/owmee_operations_integrations_and_launch_readiness.pdf` |

## Source Of Truth Used

These docs were generated from the current repo shape and should be kept aligned
with the following code and architecture sources:

- `ARCHITECTURE_AMENDMENT_V3.md`
- `docs/OWMEE_DIRECT_ACQUISITION_FLOW.md`
- `docs/VERIFICATION_ARCHITECTURE.md`
- `docs/PROVIDER_INTEGRATIONS.md`
- `docs/AI_DRAFT_ANALYSIS_PIPELINE.md`
- `docs/LISTING_CATEGORY_REQUIREMENTS.md`
- `docs/MSG91_OTP_SETUP.md`
- `backend/app/main.py`
- `backend/app/modules/**`
- `mobile/src/**`
- `admin/src/**`
- `backend/tests/test_order_e2e_contract.py`
- `backend/tests/test_checkout_payment_flow.py`
- `backend/tests/test_direct_acquisition_functional.py`
- `backend/tests/test_fe_onboarding.py`
- `backend/tests/test_listing_category_requirements.py`
- `backend/tests/test_ai_prompt_contracts.py`

## Non-Negotiable Product Decisions

- Buyer/seller chat is not supported.
- Buyer/seller meetup is not supported.
- Make Offer note or free-form chat fields must stay removed.
- Transactions are logistics-managed by Owmee.
- Seller readiness is mandatory after payment capture and before pickup.
- FE pickup inspection is a core trust gate.
- Payment capture does not mean seller payout release.
- Seller payout is gated by Owmee custody/delivery logic and seller payout/KYC readiness.
- KYC is a trust ladder and payout/dispute gate, not an upfront browsing gate.

## How To Regenerate PDFs

The current PDFs were generated with the bundled Python runtime and ReportLab.
If a document changes, regenerate the PDFs and visually verify them:

```bash
python3 scripts/render_project_docs_pdf.py
```

If the script is not present in a future checkout, any ReportLab-based Markdown
renderer can regenerate the same files from the Markdown sources. Keep final PDFs
under `output/pdf/`.
