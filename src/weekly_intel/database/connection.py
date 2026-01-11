"""Database connection and session management."""

from contextlib import contextmanager
from pathlib import Path
from typing import Generator, Optional

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from weekly_intel.config import get_config
from weekly_intel.database.models import Base

# Global engine instance
_engine: Optional[Engine] = None
_SessionLocal: Optional[sessionmaker] = None


def get_engine() -> Engine:
    """Get or create the database engine."""
    global _engine
    if _engine is None:
        config = get_config()
        db_path = Path(config.database.path)

        # Ensure the parent directory exists
        db_path.parent.mkdir(parents=True, exist_ok=True)

        # Create SQLite connection URL
        database_url = f"sqlite:///{db_path}"

        _engine = create_engine(
            database_url,
            echo=False,
            connect_args={"check_same_thread": False},  # SQLite-specific
        )

    return _engine


def get_session_factory() -> sessionmaker:
    """Get the session factory."""
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(),
            autocommit=False,
            autoflush=False,
        )
    return _SessionLocal


@contextmanager
def get_session() -> Generator[Session, None, None]:
    """Get a database session as a context manager."""
    session_factory = get_session_factory()
    session = session_factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Initialize the database schema."""
    engine = get_engine()
    Base.metadata.create_all(bind=engine)


def reset_db() -> None:
    """Drop and recreate all tables (for development)."""
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def close_db() -> None:
    """Close the database connection."""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
        _engine = None
    _SessionLocal = None
