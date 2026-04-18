"""
Chat module — vendor adapter over Stream Chat (or local stub in dev).

In dev: in-memory stub, no external calls.
In production: Stream Chat (getstream.io) — replace with Sendbird if preferred.

Channel lifecycle:
  - Opens when buyer makes offer/reserve
  - Closes (read-only) when transaction reaches terminal state
  - Evidence archived to R2 when dispute is opened

Abuse detection runs on every outgoing message.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import UUID

import structlog
import httpx

from app.core.settings import settings
from app.modules.risk.engine import scan_message, record_abuse_signal

logger = structlog.get_logger()

# ── Channel ID conventions ────────────────────────────────────────────────────

def channel_id_for_offer(offer_id: UUID) -> str:
    return f"offer_{offer_id}"

def channel_id_for_transaction(transaction_id: UUID) -> str:
    return f"txn_{transaction_id}"


# ── Dev stub ──────────────────────────────────────────────────────────────────

class _DevChatAdapter:
    """In-memory stub for local development."""

    _channels: dict[str, list[dict]] = {}

    async def create_channel(
        self, channel_id: str, buyer_id: str, seller_id: str
    ) -> dict:
        self._channels[channel_id] = []
        logger.info("chat.dev.channel_created", channel_id=channel_id)
        return {"channel_id": channel_id, "status": "open"}

    async def close_channel(self, channel_id: str) -> bool:
        logger.info("chat.dev.channel_closed", channel_id=channel_id)
        return True

    async def send_message(
        self, channel_id: str, sender_id: str, text: str, metadata: dict | None = None
    ) -> dict:
        # Run abuse scan
        scan = scan_message(text)
        if scan["blocked"]:
            return {
                "sent": False,
                "blocked": True,
                "reason": scan["reason"],
                "message": scan["message"],
            }

        msg = {
            "id": f"msg_{len(self._channels.get(channel_id, []))+ 1}",
            "sender_id": sender_id,
            "text": text,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata or {},
        }
        self._channels.setdefault(channel_id, []).append(msg)
        logger.info("chat.dev.message_sent", channel_id=channel_id, sender=sender_id)
        return {"sent": True, "message_id": msg["id"]}

    async def get_history(self, channel_id: str, limit: int = 100) -> list[dict]:
        return self._channels.get(channel_id, [])[-limit:]

    async def archive_to_evidence(self, channel_id: str, dispute_id: UUID) -> str:
        """Archive chat history to R2 for dispute evidence."""
        messages = self._channels.get(channel_id, [])
        evidence = {
            "channel_id": channel_id,
            "dispute_id": str(dispute_id),
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "messages": messages,
        }
        # In dev: log. In prod: upload to R2 evidence bucket.
        logger.info("chat.dev.evidence_archived",
                    channel_id=channel_id,
                    dispute_id=str(dispute_id),
                    message_count=len(messages))
        return f"evidence/{dispute_id}/{channel_id}.json"

    async def generate_user_token(self, user_id: str) -> str:
        """Generate a client token for connecting to chat."""
        return f"dev_token_{user_id}"


# ── Stream Chat adapter ───────────────────────────────────────────────────────

class _StreamChatAdapter:
    """
    Production adapter for Stream Chat (getstream.io).
    Requires: STREAM_API_KEY and STREAM_API_SECRET in settings.
    """

    BASE_URL = "https://chat.stream-io-api.com"

    def __init__(self):
        self.api_key = getattr(settings, 'stream_api_key', '')
        self.api_secret = getattr(settings, 'stream_api_secret', '')

    def _headers(self, jwt_token: str) -> dict:
        return {
            "Authorization": jwt_token,
            "stream-auth-type": "jwt",
            "Content-Type": "application/json",
            "X-Stream-Client": "owmee-backend-1.0",
        }

    def _server_token(self) -> str:
        """Generate server-side JWT for API calls."""
        import hmac
        import hashlib
        import base64
        import time

        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
        ).rstrip(b'=')
        payload = base64.urlsafe_b64encode(
            json.dumps({
                "server": True,
                "iat": int(time.time()),
                "exp": int(time.time()) + 3600,
            }).encode()
        ).rstrip(b'=')
        msg = header + b'.' + payload
        sig = base64.urlsafe_b64encode(
            hmac.new(self.api_secret.encode(), msg, hashlib.sha256).digest()
        ).rstrip(b'=')
        return (msg + b'.' + sig).decode()

    async def create_channel(
        self, channel_id: str, buyer_id: str, seller_id: str
    ) -> dict:
        token = self._server_token()
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"{self.BASE_URL}/channels/messaging/{channel_id}",
                params={"api_key": self.api_key},
                headers=self._headers(token),
                json={
                    "data": {
                        "members": [buyer_id, seller_id],
                        "created_by_id": "owmee-system",
                        "frozen": False,
                    }
                },
            )
            if res.status_code in (200, 201):
                logger.info("chat.stream.channel_created", channel_id=channel_id)
                return {"channel_id": channel_id, "status": "open"}
            logger.error("chat.stream.create_failed",
                         status=res.status_code, body=res.text[:200])
            return {"channel_id": channel_id, "status": "error"}

    async def close_channel(self, channel_id: str) -> bool:
        """Freeze channel — makes it read-only."""
        token = self._server_token()
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.patch(
                f"{self.BASE_URL}/channels/messaging/{channel_id}",
                params={"api_key": self.api_key},
                headers=self._headers(token),
                json={"data": {"frozen": True}},
            )
            return res.status_code == 200

    async def send_message(
        self, channel_id: str, sender_id: str, text: str, metadata: dict | None = None
    ) -> dict:
        # Abuse scan before sending
        scan = scan_message(text)
        if scan["blocked"]:
            return {
                "sent": False,
                "blocked": True,
                "reason": scan["reason"],
                "message": scan["message"],
            }

        token = self._server_token()
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"{self.BASE_URL}/channels/messaging/{channel_id}/message",
                params={"api_key": self.api_key},
                headers=self._headers(token),
                json={
                    "message": {
                        "text": text,
                        "user_id": sender_id,
                        **(metadata or {}),
                    }
                },
            )
            if res.status_code in (200, 201):
                return {"sent": True, "message_id": res.json().get("message", {}).get("id")}
            return {"sent": False, "error": res.text[:200]}

    async def get_history(self, channel_id: str, limit: int = 100) -> list[dict]:
        token = self._server_token()
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"{self.BASE_URL}/channels/messaging/{channel_id}/messages",
                params={"api_key": self.api_key, "limit": limit},
                headers=self._headers(token),
            )
            if res.status_code == 200:
                return res.json().get("messages", [])
            return []

    async def archive_to_evidence(self, channel_id: str, dispute_id: UUID) -> str:
        """Archive chat history to R2 evidence bucket."""
        messages = await self.get_history(channel_id, limit=1000)

        from app.modules.media.r2 import get_r2_client
        evidence = json.dumps({
            "channel_id": channel_id,
            "dispute_id": str(dispute_id),
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "messages": messages,
        }, default=str)

        key = f"evidence/{dispute_id}/{channel_id}.json"
        try:
            r2 = get_r2_client()
            r2.put_object(
                Bucket=settings.r2_evidence_bucket,
                Key=key,
                Body=evidence.encode(),
                ContentType="application/json",
            )
            logger.info("chat.evidence_archived", dispute_id=str(dispute_id), key=key)
        except Exception as e:
            logger.error("chat.archive_failed", error=str(e))

        return key

    async def generate_user_token(self, user_id: str) -> str:
        """Generate a user token for the Stream Chat SDK."""
        import hmac
        import hashlib
        import base64

        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
        ).rstrip(b'=')
        payload = base64.urlsafe_b64encode(
            json.dumps({"user_id": user_id}).encode()
        ).rstrip(b'=')
        msg = header + b'.' + payload
        sig = base64.urlsafe_b64encode(
            hmac.new(self.api_secret.encode(), msg, hashlib.sha256).digest()
        ).rstrip(b'=')
        return (msg + b'.' + sig).decode()


# ── Factory ───────────────────────────────────────────────────────────────────

def get_chat_adapter() -> _DevChatAdapter | _StreamChatAdapter:
    if settings.is_production and getattr(settings, 'stream_api_key', ''):
        return _StreamChatAdapter()
    return _DevChatAdapter()


# ── High-level helpers ────────────────────────────────────────────────────────

async def open_offer_channel(offer_id: UUID, buyer_id: UUID, seller_id: UUID):
    adapter = get_chat_adapter()
    cid = channel_id_for_offer(offer_id)
    await adapter.create_channel(cid, str(buyer_id), str(seller_id))
    return cid

async def close_transaction_channel(transaction_id: UUID):
    adapter = get_chat_adapter()
    cid = channel_id_for_transaction(transaction_id)
    await adapter.close_channel(cid)

async def send_and_scan(
    channel_id: str,
    sender_id: UUID,
    text: str,
    transaction_id: UUID | None = None,
) -> dict:
    """Send a message with abuse scanning. Record signals if blocked."""
    adapter = get_chat_adapter()
    result = await adapter.send_message(channel_id, str(sender_id), text)

    if result.get("blocked"):
        # Record abuse signal
        await record_abuse_signal(
            sender_id,
            reason=result["reason"],
            severity="high",
            transaction_id=transaction_id,
        )

    return result

async def archive_channel_for_dispute(transaction_id: UUID, dispute_id: UUID) -> str:
    adapter = get_chat_adapter()
    cid = channel_id_for_transaction(transaction_id)
    return await adapter.archive_to_evidence(cid, dispute_id)

async def get_chat_token(user_id: UUID) -> str:
    """Get a user token for the frontend chat SDK."""
    adapter = get_chat_adapter()
    return await adapter.generate_user_token(str(user_id))
