"""Database migrations and schema management."""

from sqlalchemy import inspect, text

from weekly_intel.database.connection import get_engine, get_session, init_db
from weekly_intel.database.models import Base


def check_schema_version() -> dict:
    """Check the current database schema state."""
    engine = get_engine()
    inspector = inspect(engine)

    existing_tables = set(inspector.get_table_names())
    expected_tables = set(Base.metadata.tables.keys())

    return {
        "existing_tables": existing_tables,
        "expected_tables": expected_tables,
        "missing_tables": expected_tables - existing_tables,
        "extra_tables": existing_tables - expected_tables,
        "is_initialized": len(expected_tables & existing_tables) == len(expected_tables),
    }


def migrate() -> dict:
    """Run database migrations.

    For SQLite MVP, this is a simple schema creation.
    In production, you'd use Alembic for proper migrations.
    """
    schema_state = check_schema_version()

    if not schema_state["is_initialized"]:
        # Create missing tables
        init_db()
        return {
            "status": "migrated",
            "created_tables": list(schema_state["missing_tables"]),
        }

    return {
        "status": "up_to_date",
        "created_tables": [],
    }


def vacuum_db() -> None:
    """Vacuum the SQLite database to reclaim space."""
    engine = get_engine()
    with engine.connect() as conn:
        conn.execute(text("VACUUM"))
        conn.commit()


def get_db_stats() -> dict:
    """Get database statistics."""
    with get_session() as session:
        stats = {}

        # Count records in each table
        for table_name in Base.metadata.tables.keys():
            result = session.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
            stats[table_name] = result.scalar()

        return stats
