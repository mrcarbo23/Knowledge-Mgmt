"""Command-line interface for Weekly Intel."""

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import click

from weekly_intel import __version__
from weekly_intel.config import get_config, load_config

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("weekly_intel")


@click.group()
@click.version_option(version=__version__)
@click.option(
    "--config",
    "-c",
    type=click.Path(exists=True),
    help="Path to configuration file",
)
@click.option("--verbose", "-v", is_flag=True, help="Enable verbose logging")
@click.pass_context
def cli(ctx: click.Context, config: Optional[str], verbose: bool):
    """Weekly Intel - Knowledge management and intelligence digest generator."""
    ctx.ensure_object(dict)

    # Set logging level
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Load configuration
    if config:
        load_config(config)
    else:
        load_config()


@cli.command()
@click.option("--force", is_flag=True, help="Overwrite existing config file")
def init(force: bool):
    """Initialize Weekly Intel (create config and database)."""
    config_path = Path("config.yaml")

    # Create config file if it doesn't exist
    if not config_path.exists() or force:
        example_path = Path("config.example.yaml")
        if example_path.exists():
            import shutil

            shutil.copy(example_path, config_path)
            click.echo(f"Created {config_path} from example")
        else:
            click.echo("Creating default config.yaml")
            # Create minimal config
            config_content = """# Weekly Intel Configuration
database:
  path: "data/weekly_intel.db"

api_keys:
  anthropic: ""  # Required: your Anthropic API key
  resend: ""     # Optional: for email delivery

output:
  digest_dir: "output/digests"
"""
            with open(config_path, "w") as f:
                f.write(config_content)
            click.echo(f"Created {config_path}")
    else:
        click.echo(f"{config_path} already exists (use --force to overwrite)")

    # Initialize database
    from weekly_intel.database import init_db
    from weekly_intel.database.migrations import migrate

    load_config(config_path)
    result = migrate()

    if result["status"] == "migrated":
        click.echo(f"Database initialized, created tables: {result['created_tables']}")
    else:
        click.echo("Database already up to date")

    # Create output directories
    config = get_config()
    Path(config.output.digest_dir).mkdir(parents=True, exist_ok=True)
    Path("data").mkdir(parents=True, exist_ok=True)

    click.echo("Initialization complete!")


# Source management commands
@cli.group()
def source():
    """Manage content sources."""
    pass


@source.command("add")
@click.argument("source_type", type=click.Choice(["substack", "gmail", "youtube"]))
@click.option("--name", "-n", required=True, help="Display name for the source")
@click.option("--url", "-u", help="RSS feed URL (for substack)")
@click.option("--label", "-l", help="Gmail label to fetch from")
@click.option("--senders", "-s", multiple=True, help="Gmail sender addresses to filter")
@click.option("--channel-id", help="YouTube channel ID")
@click.option("--playlist-id", help="YouTube playlist ID")
@click.option("--video-urls", multiple=True, help="YouTube video URLs")
def source_add(
    source_type: str,
    name: str,
    url: Optional[str],
    label: Optional[str],
    senders: tuple,
    channel_id: Optional[str],
    playlist_id: Optional[str],
    video_urls: tuple,
):
    """Add a new content source."""
    from weekly_intel.database import Source, get_session

    # Build config based on source type
    config = {}

    if source_type == "substack":
        if not url:
            raise click.UsageError("Substack source requires --url")
        config["url"] = url

    elif source_type == "gmail":
        if not label and not senders:
            raise click.UsageError("Gmail source requires --label or --senders")
        if label:
            config["label"] = label
        if senders:
            config["senders"] = list(senders)

    elif source_type == "youtube":
        if not (channel_id or playlist_id or video_urls):
            raise click.UsageError(
                "YouTube source requires --channel-id, --playlist-id, or --video-urls"
            )
        if channel_id:
            config["channel_id"] = channel_id
        if playlist_id:
            config["playlist_id"] = playlist_id
        if video_urls:
            config["video_urls"] = list(video_urls)

    with get_session() as session:
        source = Source(
            name=name,
            source_type=source_type,
            config=config,
            active=True,
        )
        session.add(source)
        session.flush()
        source_id = source.id

    click.echo(f"Added {source_type} source '{name}' (ID: {source_id})")


@source.command("list")
def source_list():
    """List all content sources."""
    from weekly_intel.database import Source, get_session

    with get_session() as session:
        sources = session.query(Source).all()

        if not sources:
            click.echo("No sources configured. Add one with: weekly-intel source add")
            return

        click.echo("\nContent Sources:")
        click.echo("-" * 60)

        for src in sources:
            status = "active" if src.active else "inactive"
            click.echo(f"[{src.id}] {src.name} ({src.source_type}) - {status}")
            for key, value in src.config.items():
                click.echo(f"     {key}: {value}")


@source.command("remove")
@click.argument("source_id", type=int)
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation")
def source_remove(source_id: int, yes: bool):
    """Remove a content source."""
    from weekly_intel.database import Source, get_session

    with get_session() as session:
        source = session.query(Source).get(source_id)

        if not source:
            click.echo(f"Source {source_id} not found")
            return

        if not yes:
            click.confirm(
                f"Remove source '{source.name}' ({source.source_type})?",
                abort=True,
            )

        session.delete(source)
        click.echo(f"Removed source {source_id}")


@source.command("toggle")
@click.argument("source_id", type=int)
def source_toggle(source_id: int):
    """Toggle a source active/inactive."""
    from weekly_intel.database import Source, get_session

    with get_session() as session:
        source = session.query(Source).get(source_id)

        if not source:
            click.echo(f"Source {source_id} not found")
            return

        source.active = not source.active
        status = "active" if source.active else "inactive"
        click.echo(f"Source '{source.name}' is now {status}")


# Ingestion command
@cli.command()
@click.option("--source-id", "-s", type=int, help="Ingest from specific source only")
@click.option(
    "--since",
    type=click.DateTime(formats=["%Y-%m-%d"]),
    help="Only ingest content published on or after this date (YYYY-MM-DD)",
)
@click.option("--force", is_flag=True, help="Re-ingest items that already exist in the database")
def ingest(source_id: Optional[int], since: Optional[datetime], force: bool):
    """Ingest content from configured sources."""
    from weekly_intel.database import Source, get_session
    from weekly_intel.ingestion import get_ingestor

    with get_session() as session:
        query = session.query(Source).filter(Source.active == True)
        if source_id:
            query = query.filter(Source.id == source_id)

        sources = query.all()

        if not sources:
            click.echo("No active sources found")
            return

        if since:
            click.echo(f"Ingesting from {len(sources)} source(s) (since {since.date()})...")
        else:
            click.echo(f"Ingesting from {len(sources)} source(s)...")
        if force:
            click.echo("Force mode: will re-ingest existing items")

        total_new = 0
        total_updated = 0
        total_skipped = 0
        total_failed = 0

        for src in sources:
            click.echo(f"\n[{src.name}] ({src.source_type})")

            try:
                ingestor_cls = get_ingestor(src.source_type)
                ingestor = ingestor_cls(src.id, src.config, since_date=since, force=force)

                result = ingestor.ingest()

                click.echo(
                    f"  Found: {result.items_found}, "
                    f"New: {result.items_new}, "
                    f"Updated: {result.items_updated}, "
                    f"Skipped: {result.items_skipped}, "
                    f"Failed: {result.items_failed}"
                )

                if result.errors:
                    for error in result.errors[:3]:
                        click.echo(f"  Error: {error}", err=True)

                total_new += result.items_new
                total_updated += result.items_updated
                total_skipped += result.items_skipped
                total_failed += result.items_failed

            except Exception as e:
                click.echo(f"  Failed: {e}", err=True)
                total_failed += 1

        click.echo(f"\nTotal: {total_new} new, {total_updated} updated, {total_skipped} skipped, {total_failed} failed")


# Processing command
@cli.command()
@click.option("--reprocess", is_flag=True, help="Reprocess all items (deletes existing)")
@click.option("--week", "-w", help="Week number (YYYY-WW) for clustering")
def process(reprocess: bool, week: Optional[str]):
    """Process ingested content with LLM extraction."""
    from weekly_intel.processing import ProcessingPipeline

    if reprocess:
        if not click.confirm("This will delete all processed data. Continue?"):
            return

    click.echo("Starting processing pipeline...")

    pipeline = ProcessingPipeline()

    if reprocess:
        result = pipeline.reprocess_all(week)
    else:
        result = pipeline.process_new_items(week)

    click.echo(
        f"\nProcessing complete:\n"
        f"  Processed: {result.items_processed}\n"
        f"  Skipped (duplicates): {result.items_skipped}\n"
        f"  Failed: {result.items_failed}\n"
        f"  Clusters created: {result.clusters_created}"
    )

    if result.errors:
        click.echo("\nErrors:")
        for error in result.errors[:5]:
            click.echo(f"  - {error}")


# Digest command
@cli.command()
@click.option("--week", "-w", help="Week number (YYYY-WW), defaults to current week")
@click.option("--send", is_flag=True, help="Send digest via email after generation")
@click.option("--to", multiple=True, help="Override email recipients")
def digest(week: Optional[str], send: bool, to: tuple):
    """Generate weekly digest."""
    from weekly_intel.digest import DigestGenerator

    if week is None:
        week = datetime.utcnow().strftime("%Y-%W")

    click.echo(f"Generating digest for week {week}...")

    generator = DigestGenerator()
    content = generator.generate(week)

    if content.items_count == 0:
        click.echo("No content found for this week. Run 'ingest' and 'process' first.")
        return

    md_path, html_path = generator.save_digest(content)

    click.echo(f"\nDigest generated:")
    click.echo(f"  Markdown: {md_path}")
    click.echo(f"  HTML: {html_path}")
    click.echo(f"  Sources: {content.sources_count}")
    click.echo(f"  Items: {content.items_count}")
    click.echo(f"  Themes: {len(content.themes)}")

    if send:
        from weekly_intel.delivery import EmailDelivery

        config = get_config()

        if not config.api_keys.resend:
            click.echo("\nEmail delivery not configured (no Resend API key)")
            return

        recipients = list(to) if to else config.email.recipients

        if not recipients:
            click.echo("\nNo recipients configured for email")
            return

        click.echo(f"\nSending to {len(recipients)} recipient(s)...")

        delivery = EmailDelivery()
        results = delivery.send_digest_to_all(content, recipients)

        for result in results:
            status = "sent" if result.success else f"failed: {result.error}"
            click.echo(f"  {result.recipient}: {status}")


# Gmail auth command
@cli.group()
def gmail():
    """Gmail integration commands."""
    pass


@gmail.command("auth")
def gmail_auth():
    """Run Gmail OAuth authentication flow."""
    from weekly_intel.ingestion.gmail import run_oauth_flow

    click.echo("Starting Gmail OAuth flow...")
    click.echo("A browser window will open for authentication.")

    if run_oauth_flow():
        click.echo("\nGmail authentication successful!")
    else:
        click.echo("\nGmail authentication failed.", err=True)
        sys.exit(1)


# Scheduler command
@cli.group()
def scheduler():
    """Scheduler daemon commands."""
    pass


@scheduler.command("start")
@click.option("--foreground", "-f", is_flag=True, help="Run in foreground")
def scheduler_start(foreground: bool):
    """Start the scheduler daemon."""
    from weekly_intel.scheduler import start_scheduler

    click.echo("Starting scheduler...")
    start_scheduler(foreground=foreground)


@scheduler.command("run-once")
@click.argument("job", type=click.Choice(["ingest", "digest"]))
def scheduler_run_once(job: str):
    """Run a scheduled job once."""
    from weekly_intel.scheduler import run_job

    click.echo(f"Running {job} job...")
    run_job(job)
    click.echo("Job completed")


# Stats command
@cli.command()
def stats():
    """Show database statistics."""
    from weekly_intel.database.migrations import get_db_stats

    stats = get_db_stats()

    click.echo("\nDatabase Statistics:")
    click.echo("-" * 40)

    for table, count in sorted(stats.items()):
        click.echo(f"  {table}: {count}")


if __name__ == "__main__":
    cli()
