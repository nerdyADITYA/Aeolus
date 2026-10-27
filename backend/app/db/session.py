from __future__ import annotations

from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import Base

engine = None
SessionLocal: sessionmaker | None = None


def init_db(db_path: Path | str) -> None:
    """(Re)bind the global engine to a SQLite file and create the tables."""
    global engine, SessionLocal
    if engine is not None:
        engine.dispose()
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    _drop_retired_columns()
    SessionLocal = sessionmaker(engine, expire_on_commit=False)


def _drop_retired_columns() -> None:
    """Databases created before the Quick option was removed still have a NOT NULL `site.profile` column; drop it."""
    if "profile" in {c["name"] for c in inspect(engine).get_columns("site")}:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE site DROP COLUMN profile"))


@contextmanager
def session_scope() -> Iterator[Session]:
    if SessionLocal is None:
        raise RuntimeError("Database not initialised")
    s = SessionLocal()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def get_db() -> Iterator[Session]:
    """FastAPI dependency."""
    with session_scope() as s:
        yield s
