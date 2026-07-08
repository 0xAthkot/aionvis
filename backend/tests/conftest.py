"""Shared test guards.

Tests build their own in-memory store (no lifespan → no store.load()), so a
stray store.save() would OVERWRITE the real data/state.json with test
fixtures — this happened once and cost the demo history. Persistence is
disabled for every test; anything exercising save/load semantics must
opt out explicitly with its own tmp-file monkeypatching.
"""

import pytest

from app.store import store


@pytest.fixture(autouse=True)
def never_touch_real_state(monkeypatch):
    monkeypatch.setattr(store, "save", lambda: None)
    yield
