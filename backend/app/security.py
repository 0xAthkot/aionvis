"""Shared API-key validation for REST middleware and WebSocket handshakes.

Two kinds of credential authenticate against a protected node:
  - the node's root AA_API_KEY (backend/.env, minted by deploy_mi300x.sh);
  - any per-person key minted via POST /settings/api-keys ("aa_live_…"),
    individually revocable via DELETE — hand each teammate/judge their own
    instead of sharing the root key.
Auth is active whenever AA_API_KEY is non-empty; an empty root key leaves
the node open for same-machine dev (minted keys are then moot).
"""

import hmac

from .config import settings
from .store import now_iso, store


def valid_api_key(presented: str) -> bool:
    if not presented:
        return False
    if hmac.compare_digest(presented, settings.aa_api_key):
        return True
    for key in store.api_keys.values():
        if key.secret and hmac.compare_digest(presented, key.secret):
            # Persisted on the next store.save(); not worth a disk write
            # per request.
            key.last_used_at = now_iso()
            return True
    return False
