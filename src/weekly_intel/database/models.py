"""SQLAlchemy ORM models for Weekly Intel."""

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models."""

    pass


class Source(Base):
    """Content source (Substack, Gmail, YouTube)."""

    __tablename__ = "sources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)  # substack, gmail, youtube
    config: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    content_items: Mapped[list["ContentItem"]] = relationship("ContentItem", back_populates="source")

    def __repr__(self) -> str:
        return f"<Source(id={self.id}, name='{self.name}', type='{self.source_type}')>"


class ContentItem(Base):
    """Raw content item from a source."""

    __tablename__ = "content_items"
    __table_args__ = (
        UniqueConstraint("source_id", "external_id", name="uq_source_external"),
        Index("ix_content_items_published_at", "published_at"),
        Index("ix_content_items_fingerprint", "fingerprint"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_id: Mapped[int] = mapped_column(Integer, ForeignKey("sources.id"), nullable=False)
    external_id: Mapped[str] = mapped_column(String(512), nullable=False)  # RSS guid, message ID, video ID
    title: Mapped[Optional[str]] = mapped_column(String(1024))
    author: Mapped[Optional[str]] = mapped_column(String(255))
    content_text: Mapped[Optional[str]] = mapped_column(Text)
    content_html: Mapped[Optional[str]] = mapped_column(Text)
    url: Mapped[Optional[str]] = mapped_column(String(2048))
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    ingested_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    fingerprint: Mapped[Optional[str]] = mapped_column(String(512))  # MinHash signature

    # Relationships
    source: Mapped["Source"] = relationship("Source", back_populates="content_items")
    processed_item: Mapped[Optional["ProcessedItem"]] = relationship(
        "ProcessedItem", back_populates="content_item", uselist=False
    )

    def __repr__(self) -> str:
        return f"<ContentItem(id={self.id}, title='{self.title[:50] if self.title else None}...')>"


class ProcessedItem(Base):
    """Processed content with LLM extractions."""

    __tablename__ = "processed_items"
    __table_args__ = (Index("ix_processed_items_processed_at", "processed_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    content_item_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_items.id"), nullable=False, unique=True
    )
    summary: Mapped[Optional[str]] = mapped_column(Text)
    key_information: Mapped[Optional[dict]] = mapped_column(JSON)  # Extracted facts/announcements
    themes: Mapped[Optional[list]] = mapped_column(JSON)  # Identified themes
    hot_takes: Mapped[Optional[list]] = mapped_column(JSON)  # Contrarian views
    entities: Mapped[Optional[dict]] = mapped_column(JSON)  # Named entities
    embedding: Mapped[Optional[bytes]] = mapped_column(LargeBinary)  # 384-dim float32 vector
    processed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    content_item: Mapped["ContentItem"] = relationship("ContentItem", back_populates="processed_item")
    cluster_memberships: Mapped[list["ClusterMember"]] = relationship(
        "ClusterMember", back_populates="processed_item"
    )

    def __repr__(self) -> str:
        return f"<ProcessedItem(id={self.id}, content_item_id={self.content_item_id})>"


class StoryCluster(Base):
    """Cluster of related stories."""

    __tablename__ = "story_clusters"
    __table_args__ = (Index("ix_story_clusters_week_number", "week_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_number: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-WW
    name: Mapped[Optional[str]] = mapped_column(String(255))  # Cluster theme name
    canonical_item_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("processed_items.id"))
    synthesized_summary: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    canonical_item: Mapped[Optional["ProcessedItem"]] = relationship("ProcessedItem")
    members: Mapped[list["ClusterMember"]] = relationship("ClusterMember", back_populates="cluster")

    def __repr__(self) -> str:
        return f"<StoryCluster(id={self.id}, name='{self.name}', week='{self.week_number}')>"


class ClusterMember(Base):
    """Association between clusters and processed items."""

    __tablename__ = "cluster_members"
    __table_args__ = (UniqueConstraint("cluster_id", "processed_item_id", name="uq_cluster_item"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cluster_id: Mapped[int] = mapped_column(Integer, ForeignKey("story_clusters.id"), nullable=False)
    processed_item_id: Mapped[int] = mapped_column(Integer, ForeignKey("processed_items.id"), nullable=False)
    similarity_score: Mapped[Optional[float]] = mapped_column(Float)

    # Relationships
    cluster: Mapped["StoryCluster"] = relationship("StoryCluster", back_populates="members")
    processed_item: Mapped["ProcessedItem"] = relationship("ProcessedItem", back_populates="cluster_memberships")

    def __repr__(self) -> str:
        return f"<ClusterMember(cluster_id={self.cluster_id}, item_id={self.processed_item_id})>"


class WeeklyDigest(Base):
    """Generated weekly digest."""

    __tablename__ = "weekly_digests"
    __table_args__ = (Index("ix_weekly_digests_week_number", "week_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    week_number: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)  # YYYY-WW
    date_range: Mapped[str] = mapped_column(String(50))  # "Jan 1-7, 2026"
    sources_count: Mapped[int] = mapped_column(Integer, default=0)
    items_count: Mapped[int] = mapped_column(Integer, default=0)
    markdown_path: Mapped[Optional[str]] = mapped_column(String(512))
    html_path: Mapped[Optional[str]] = mapped_column(String(512))
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    email_logs: Mapped[list["EmailLog"]] = relationship("EmailLog", back_populates="digest")

    def __repr__(self) -> str:
        return f"<WeeklyDigest(id={self.id}, week='{self.week_number}')>"


class EmailLog(Base):
    """Email delivery log."""

    __tablename__ = "email_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    digest_id: Mapped[int] = mapped_column(Integer, ForeignKey("weekly_digests.id"), nullable=False)
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)  # sent, failed, bounced
    provider_message_id: Mapped[Optional[str]] = mapped_column(String(255))
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    error_message: Mapped[Optional[str]] = mapped_column(Text)

    # Relationships
    digest: Mapped["WeeklyDigest"] = relationship("WeeklyDigest", back_populates="email_logs")

    def __repr__(self) -> str:
        return f"<EmailLog(id={self.id}, recipient='{self.recipient}', status='{self.status}')>"
