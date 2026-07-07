# Auto-Annotator

@HANDOFF.md

Non-negotiables for every change:

- **Contract-first**: types.ts → endpoints.ts → MSW handler → Pydantic
  schema → backend route → BACKEND_CONTRACT.md. Never let the mock and the
  real backend drift.
- **Never** install `rfdetr` (or anything wanting `transformers>=5`) into
  `backend/.venv` — it breaks SDXL. RF-DETR lives in `backend/.venv-rfdetr`.
- **Simple mode doctrine**: capability parity with Pro. Rename, explain,
  or progressively disclose — never remove features or tabs.
- Verify claims by running things (smoke_test.py, real pipeline runs, lint,
  tsc) before reporting them done.
