from __future__ import annotations

import json
import os
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Integer, String, Text, create_engine, delete, func, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker


class Base(DeclarativeBase):
    pass


class RaamResult(Base):
    __tablename__ = "raam_results"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_date: Mapped[Any] = mapped_column(Date, nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    data1: Mapped[int] = mapped_column(Integer, nullable=False)
    data2: Mapped[int] = mapped_column(Integer, nullable=False)
    data3: Mapped[int] = mapped_column(Integer, nullable=False)
    data4: Mapped[int] = mapped_column(Integer, nullable=False)
    tls: Mapped[int] = mapped_column(Integer, nullable=False)
    alpha0: Mapped[float] = mapped_column(Float, nullable=False)
    alpha1: Mapped[float] = mapped_column(Float, nullable=False)
    alpha2: Mapped[float] = mapped_column(Float, nullable=False)
    alpha3: Mapped[float] = mapped_column(Float, nullable=False)
    beta0: Mapped[float] = mapped_column(Float, nullable=False)
    beta1: Mapped[float] = mapped_column(Float, nullable=False)
    beta2: Mapped[float] = mapped_column(Float, nullable=False)
    beta3: Mapped[float] = mapped_column(Float, nullable=False)
    changed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)


class MonitorState(Base):
    __tablename__ = "monitor_state"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class MonitorLog(Base):
    __tablename__ = "monitor_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    level: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    p256dh: Mapped[str] = mapped_column(Text, nullable=False)
    auth: Mapped[str] = mapped_column(Text, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Notification preferences are independent: NASA and K-69 never share a toggle.
    nasa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("TRUE"))
    k69_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=text("TRUE"))


class K69AlertSchedule(Base):
    __tablename__ = "k69_alert_schedules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    endpoint: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    cycle_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    seconds_before: Mapped[int] = mapped_column(Integer, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    armed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


def _normalize_database_url(raw_url: str) -> str:
    url = raw_url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


DATABASE_URL = _normalize_database_url(os.getenv("DATABASE_URL", ""))
DATABASE_ENABLED = bool(DATABASE_URL)
engine = None
SessionLocal = None

if DATABASE_ENABLED:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=300, connect_args={"connect_timeout": 15})
    SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, class_=Session)


@contextmanager
def session_scope() -> Iterator[Session]:
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL is not configured")
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def initialize_database() -> None:
    if DATABASE_ENABLED and engine is not None:
        Base.metadata.create_all(engine)
        # Backward-compatible migration for databases created before background
        # K-69 "arm" delivery was introduced.
        with engine.begin() as connection:
            connection.execute(
                text(
                    "ALTER TABLE k69_alert_schedules "
                    "ADD COLUMN IF NOT EXISTS armed_at TIMESTAMPTZ"
                )
            )
            # Independent notification preferences; safe for existing databases.
            connection.execute(text(
                "ALTER TABLE push_subscriptions "
                "ADD COLUMN IF NOT EXISTS nasa_enabled BOOLEAN NOT NULL DEFAULT TRUE"
            ))
            connection.execute(text(
                "ALTER TABLE push_subscriptions "
                "ADD COLUMN IF NOT EXISTS k69_enabled BOOLEAN NOT NULL DEFAULT TRUE"
            ))


def database_status() -> dict[str, Any]:
    if not DATABASE_ENABLED or engine is None:
        return {"enabled": False, "connected": False, "message": "DATABASE_URL is not configured"}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"enabled": True, "connected": True, "message": "PostgreSQL connected"}
    except SQLAlchemyError as error:
        return {"enabled": True, "connected": False, "message": str(error)[:240]}


def _result_signature(payload: dict[str, Any]) -> tuple[int, int, int, int, int]:
    return tuple(int(payload[key]) for key in ("data1", "data2", "data3", "data4", "tls"))


def set_monitor_state(session: Session, key: str, value: str) -> None:
    now = datetime.now(timezone.utc)
    state = session.get(MonitorState, key)
    if state is None:
        session.add(MonitorState(key=key, value=value, updated_at=now))
    else:
        state.value = value
        state.updated_at = now


def set_state_values(values: dict[str, Any]) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        for key, value in values.items():
            if isinstance(value, (dict, list)):
                value = json.dumps(value, ensure_ascii=False)
            set_monitor_state(session, key, str(value))


def save_raam_result(payload: dict[str, Any]) -> dict[str, Any]:
    if not DATABASE_ENABLED:
        return {"saved": False, "reason": "database_disabled", "changed": False}

    source_date = datetime.fromisoformat(payload["source_date"]).date()
    updated_at = datetime.fromisoformat(payload["updated_at"].replace("Z", "+00:00"))
    checked_at = datetime.now(timezone.utc)
    alpha, beta = list(payload["alpha"]), list(payload["beta"])

    with session_scope() as session:
        previous = session.scalar(select(RaamResult).order_by(RaamResult.id.desc()).limit(1))
        changed = previous is None or _result_signature(payload) != (previous.data1, previous.data2, previous.data3, previous.data4, previous.tls)

        if previous and not changed and previous.file_name == payload["file_name"]:
            previous.checked_at = checked_at
            set_monitor_state(session, "last_check_at", checked_at.isoformat())
            return {"saved": False, "reason": "duplicate", "changed": False, "id": previous.id}

        changes: list[str] = []
        if previous:
            for key in ("data1", "data2", "data3", "data4", "tls"):
                old, new = int(getattr(previous, key)), int(payload[key])
                if old != new:
                    changes.append(f"{key}: {old} -> {new}")

        row = RaamResult(
            file_name=payload["file_name"], source_date=source_date, updated_at=updated_at,
            checked_at=checked_at, data1=int(payload["data1"]), data2=int(payload["data2"]),
            data3=int(payload["data3"]), data4=int(payload["data4"]), tls=int(payload["tls"]),
            alpha0=float(alpha[0]), alpha1=float(alpha[1]), alpha2=float(alpha[2]), alpha3=float(alpha[3]),
            beta0=float(beta[0]), beta1=float(beta[1]), beta2=float(beta[2]), beta3=float(beta[3]),
            changed=changed, change_summary="; ".join(changes) if changes else None,
        )
        session.add(row)
        session.flush()
        set_monitor_state(session, "last_check_at", checked_at.isoformat())
        set_monitor_state(session, "last_file_name", payload["file_name"])
        if changed:
            set_monitor_state(session, "last_change_at", checked_at.isoformat())
            set_monitor_state(session, "last_result_id", str(row.id))
        return {"saved": True, "changed": changed, "id": row.id, "changes": changes, "had_previous": previous is not None}


def get_history(limit: int = 30) -> list[dict[str, Any]]:
    if not DATABASE_ENABLED:
        return []
    limit = max(1, min(limit, 100))
    with session_scope() as session:
        rows = session.scalars(select(RaamResult).order_by(RaamResult.id.desc()).limit(limit)).all()
        return [{
            "id": row.id, "file_name": row.file_name, "source_date": row.source_date.isoformat(),
            "updated_at": row.updated_at.isoformat(), "checked_at": row.checked_at.isoformat(),
            "data1": row.data1, "data2": row.data2, "data3": row.data3, "data4": row.data4, "tls": row.tls,
            "alpha": [row.alpha0, row.alpha1, row.alpha2, row.alpha3],
            "beta": [row.beta0, row.beta1, row.beta2, row.beta3],
            "changed": row.changed, "change_summary": row.change_summary,
        } for row in rows]


def get_monitor_state() -> dict[str, str]:
    if not DATABASE_ENABLED:
        return {}
    with session_scope() as session:
        rows = session.scalars(select(MonitorState)).all()
        return {row.key: row.value for row in rows}


def upsert_push_subscription(subscription: dict[str, Any], user_agent: str | None = None) -> None:
    if not DATABASE_ENABLED:
        raise RuntimeError("DATABASE_URL is required for push subscriptions")
    endpoint = subscription["endpoint"]
    keys = subscription.get("keys") or {}
    if not keys.get("p256dh") or not keys.get("auth"):
        raise ValueError("Invalid push subscription keys")
    with session_scope() as session:
        row = session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
        if row is None:
            row = PushSubscription(endpoint=endpoint, p256dh=keys["p256dh"], auth=keys["auth"], user_agent=user_agent, created_at=datetime.now(timezone.utc))
            session.add(row)
        else:
            row.p256dh, row.auth, row.user_agent = keys["p256dh"], keys["auth"], user_agent


def remove_push_subscription(endpoint: str) -> int:
    if not DATABASE_ENABLED:
        return 0
    with session_scope() as session:
        result = session.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
        return int(result.rowcount or 0)


def list_push_subscriptions() -> list[dict[str, Any]]:
    if not DATABASE_ENABLED:
        return []
    with session_scope() as session:
        rows = session.scalars(select(PushSubscription).order_by(PushSubscription.id)).all()
        return [{
            "id": row.id,
            "endpoint": row.endpoint,
            "keys": {"p256dh": row.p256dh, "auth": row.auth},
            "nasa_enabled": bool(row.nasa_enabled),
            "k69_enabled": bool(row.k69_enabled),
        } for row in rows]


def mark_push_success(subscription_id: int) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        row = session.get(PushSubscription, subscription_id)
        if row:
            row.last_success_at = datetime.now(timezone.utc)


def delete_push_subscription_by_id(subscription_id: int) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        row = session.get(PushSubscription, subscription_id)
        if row:
            session.delete(row)


def push_subscription_count() -> int:
    return len(list_push_subscriptions())


def get_push_subscription(endpoint: str) -> dict[str, Any] | None:
    if not DATABASE_ENABLED:
        return None
    with session_scope() as session:
        row = session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
        if row is None:
            return None
        return {"id": row.id, "endpoint": row.endpoint, "p256dh": row.p256dh, "auth": row.auth,
                "nasa_enabled": bool(row.nasa_enabled), "k69_enabled": bool(row.k69_enabled)}


def set_push_preferences(endpoint: str, *, nasa_enabled: bool | None = None, k69_enabled: bool | None = None) -> bool:
    if not DATABASE_ENABLED:
        raise RuntimeError("DATABASE_URL is required for notification preferences")
    with session_scope() as session:
        row = session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
        if row is None:
            return False
        if nasa_enabled is not None:
            row.nasa_enabled = bool(nasa_enabled)
        if k69_enabled is not None:
            row.k69_enabled = bool(k69_enabled)
        return True


def get_push_preferences(endpoint: str) -> dict[str, bool] | None:
    if not DATABASE_ENABLED:
        return None
    with session_scope() as session:
        row = session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
        if row is None:
            return None
        return {"nasa_enabled": bool(row.nasa_enabled), "k69_enabled": bool(row.k69_enabled)}


def replace_k69_alert_schedule(endpoint: str, cycle_at: datetime, seconds_before: list[int]) -> int:
    if not DATABASE_ENABLED:
        raise RuntimeError("DATABASE_URL is required for K69 alert scheduling")
    now = datetime.now(timezone.utc)
    cycle_at = cycle_at.astimezone(timezone.utc)
    with session_scope() as session:
        session.execute(
            delete(K69AlertSchedule).where(
                K69AlertSchedule.endpoint == endpoint,
                K69AlertSchedule.cycle_at == cycle_at,
            )
        )
        rows = [
            K69AlertSchedule(
                endpoint=endpoint,
                cycle_at=cycle_at,
                seconds_before=int(value),
                created_at=now,
            )
            for value in sorted(set(seconds_before), reverse=True)
        ]
        session.add_all(rows)
        return len(rows)


def mark_k69_alert_sent(schedule_id: int) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        row = session.get(K69AlertSchedule, schedule_id)
        if row is not None and row.sent_at is None:
            row.sent_at = datetime.now(timezone.utc)


def get_k69_schedule_ids(endpoint: str, cycle_at: datetime) -> list[int]:
    if not DATABASE_ENABLED:
        return []
    with session_scope() as session:
        rows = session.scalars(
            select(K69AlertSchedule)
            .where(
                K69AlertSchedule.endpoint == endpoint,
                K69AlertSchedule.cycle_at == cycle_at.astimezone(timezone.utc),
                K69AlertSchedule.sent_at.is_(None),
            )
            .order_by(K69AlertSchedule.seconds_before.desc())
        ).all()
        return [int(row.id) for row in rows]


def mark_k69_alerts_armed(endpoint: str, schedule_ids: list[int]) -> int:
    if not DATABASE_ENABLED or not schedule_ids:
        return 0
    with session_scope() as session:
        rows = session.scalars(
            select(K69AlertSchedule).where(
                K69AlertSchedule.id.in_(schedule_ids),
                K69AlertSchedule.endpoint == endpoint,
            )
        ).all()
        now = datetime.now(timezone.utc)
        changed = 0
        for row in rows:
            if row.sent_at is None and row.armed_at is None:
                row.armed_at = now
                changed += 1
        return changed


def due_k69_alerts(now: datetime | None = None) -> list[dict[str, Any]]:
    if not DATABASE_ENABLED:
        return []
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    with session_scope() as session:
        rows = session.scalars(
            select(K69AlertSchedule)
            .where(
                K69AlertSchedule.sent_at.is_(None),
                K69AlertSchedule.cycle_at >= now - timedelta(seconds=30),
                K69AlertSchedule.cycle_at <= now + timedelta(seconds=61),
            )
            .order_by(K69AlertSchedule.cycle_at, K69AlertSchedule.seconds_before)
        ).all()
        result = []
        for row in rows:
            due_at = row.cycle_at - timedelta(seconds=row.seconds_before)
            if due_at <= now:
                result.append({
                    "id": row.id,
                    "endpoint": row.endpoint,
                    "cycle_at": row.cycle_at,
                    "seconds_before": row.seconds_before,
                })
        return result


def add_monitor_log(level: str, event: str, message: str, details: Any | None = None, duration_ms: int | None = None) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        session.add(MonitorLog(
            created_at=datetime.now(timezone.utc),
            level=level[:16], event=event[:80], message=message,
            details=json.dumps(details, ensure_ascii=False) if isinstance(details, (dict, list)) else (str(details) if details is not None else None),
            duration_ms=duration_ms,
        ))

def get_monitor_logs(limit: int = 100) -> list[dict[str, Any]]:
    if not DATABASE_ENABLED:
        return []
    limit = max(1, min(limit, 500))
    with session_scope() as session:
        rows = session.scalars(select(MonitorLog).order_by(MonitorLog.id.desc()).limit(limit)).all()
        return [{
            "id": row.id, "created_at": row.created_at.isoformat(), "level": row.level,
            "event": row.event, "message": row.message, "details": row.details,
            "duration_ms": row.duration_ms,
        } for row in rows]

def get_admin_statistics() -> dict[str, Any]:
    if not DATABASE_ENABLED:
        return {"results": 0, "checks": 0, "changes": 0, "errors": 0, "subscribers": 0}
    with session_scope() as session:
        results = session.scalar(select(func.count()).select_from(RaamResult)) or 0
        changes = session.scalar(select(func.count()).select_from(RaamResult).where(RaamResult.changed.is_(True))) or 0
        checks = session.scalar(select(func.count()).select_from(MonitorLog).where(MonitorLog.event.in_(["monitor_no_change", "monitor_new_file", "monitor_baseline", "monitor_error"]))) or 0
        errors = session.scalar(select(func.count()).select_from(MonitorLog).where(MonitorLog.level == "error")) or 0
        subscribers = session.scalar(select(func.count()).select_from(PushSubscription)) or 0
        return {"results": int(results), "checks": int(checks), "changes": int(changes), "errors": int(errors), "subscribers": int(subscribers)}

class GnssRegionalSample(Base):
    __tablename__ = "gnss_regional_samples"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    lat_cell: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    lon_cell: Mapped[float] = mapped_column(Float, nullable=False, index=True)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    accuracy_m: Mapped[float] = mapped_column(Float, nullable=False)
    fix_ratio: Mapped[float] = mapped_column(Float, nullable=False)


def save_gnss_sample(lat_cell: float, lon_cell: float, score: int, accuracy_m: float, fix_ratio: float) -> None:
    if not DATABASE_ENABLED:
        return
    with session_scope() as session:
        session.add(GnssRegionalSample(created_at=datetime.now(timezone.utc), lat_cell=round(float(lat_cell), 1), lon_cell=round(float(lon_cell), 1), score=max(0,min(100,int(score))), accuracy_m=max(0,float(accuracy_m)), fix_ratio=max(0,min(1,float(fix_ratio)))))


def get_gnss_region(lat_cell: float, lon_cell: float, hours: int = 2) -> dict[str, Any]:
    if not DATABASE_ENABLED:
        return {"available": False, "count": 0}
    cutoff = datetime.now(timezone.utc) - __import__('datetime').timedelta(hours=max(1,min(hours,24)))
    lat, lon = round(float(lat_cell),1), round(float(lon_cell),1)
    with session_scope() as session:
        rows = session.scalars(select(GnssRegionalSample).where(GnssRegionalSample.created_at >= cutoff, GnssRegionalSample.lat_cell.between(lat-.3,lat+.3), GnssRegionalSample.lon_cell.between(lon-.3,lon+.3))).all()
        if not rows: return {"available": True, "count": 0}
        scores=[r.score for r in rows]; accuracies=[r.accuracy_m for r in rows]
        return {"available": True, "count": len(rows), "score": round(sum(scores)/len(scores)), "accuracy_m": round(sum(accuracies)/len(accuracies),1), "updated_at": max(r.created_at for r in rows).isoformat()}
