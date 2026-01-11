"""Scheduler for automated ingestion and digest generation."""

import logging
import signal
import sys
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from weekly_intel.config import get_config

logger = logging.getLogger(__name__)


def ingest_job():
    """Run ingestion from all active sources."""
    logger.info("Running scheduled ingestion job")

    from weekly_intel.database import Source, get_session
    from weekly_intel.ingestion import get_ingestor

    with get_session() as session:
        sources = session.query(Source).filter(Source.active == True).all()

        total_new = 0
        for src in sources:
            try:
                ingestor_cls = get_ingestor(src.source_type)
                ingestor = ingestor_cls(src.id, src.config)
                result = ingestor.ingest()
                total_new += result.items_new
                logger.info(
                    f"Ingested from {src.name}: {result.items_new} new items"
                )
            except Exception as e:
                logger.error(f"Failed to ingest from {src.name}: {e}")

    logger.info(f"Ingestion complete: {total_new} new items total")


def process_job():
    """Run processing pipeline on new items."""
    logger.info("Running scheduled processing job")

    from weekly_intel.processing import ProcessingPipeline

    try:
        pipeline = ProcessingPipeline()
        result = pipeline.process_new_items()
        logger.info(
            f"Processing complete: {result.items_processed} processed, "
            f"{result.clusters_created} clusters"
        )
    except Exception as e:
        logger.error(f"Processing failed: {e}")


def digest_job():
    """Generate and optionally send weekly digest."""
    logger.info("Running scheduled digest job")
    config = get_config()

    from weekly_intel.digest import DigestGenerator

    try:
        generator = DigestGenerator()
        content = generator.generate()

        if content.items_count == 0:
            logger.warning("No content for digest this week")
            return

        md_path, html_path = generator.save_digest(content)
        logger.info(f"Digest saved: {md_path}, {html_path}")

        # Send email if auto_send is enabled
        if config.scheduler.auto_send and config.email.enabled:
            from weekly_intel.delivery import EmailDelivery

            delivery = EmailDelivery()
            results = delivery.send_digest_to_all(content)

            success = sum(1 for r in results if r.success)
            logger.info(f"Digest sent to {success}/{len(results)} recipients")

    except Exception as e:
        logger.error(f"Digest generation failed: {e}")


def run_job(job_name: str):
    """Run a specific job immediately.

    Args:
        job_name: Name of job to run (ingest, process, digest)
    """
    jobs = {
        "ingest": ingest_job,
        "process": process_job,
        "digest": digest_job,
    }

    if job_name not in jobs:
        raise ValueError(f"Unknown job: {job_name}")

    jobs[job_name]()


def parse_cron(cron_str: str) -> dict:
    """Parse a cron string into APScheduler trigger kwargs.

    Args:
        cron_str: Standard cron format "minute hour day month day_of_week"

    Returns:
        Dict of trigger kwargs
    """
    parts = cron_str.split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron format: {cron_str}")

    return {
        "minute": parts[0],
        "hour": parts[1],
        "day": parts[2],
        "month": parts[3],
        "day_of_week": parts[4],
    }


def start_scheduler(foreground: bool = True):
    """Start the scheduler daemon.

    Args:
        foreground: If True, run in foreground (blocking).
                   If False, run in background.
    """
    config = get_config()

    # Choose scheduler type
    if foreground:
        scheduler = BlockingScheduler()
    else:
        scheduler = BackgroundScheduler()

    # Parse cron schedules
    try:
        ingest_trigger = CronTrigger(**parse_cron(config.scheduler.ingest_cron))
        digest_trigger = CronTrigger(**parse_cron(config.scheduler.digest_cron))
    except Exception as e:
        logger.error(f"Invalid cron configuration: {e}")
        sys.exit(1)

    # Add jobs
    scheduler.add_job(
        ingest_job,
        trigger=ingest_trigger,
        id="ingest",
        name="Content Ingestion",
        replace_existing=True,
    )

    # Process job runs after ingest (with a delay)
    # Schedule it 30 minutes after ingest
    process_parts = config.scheduler.ingest_cron.split()
    process_minute = str((int(process_parts[0]) + 30) % 60)
    process_hour = process_parts[1]
    if int(process_parts[0]) + 30 >= 60:
        # Handle hour rollover
        if process_hour != "*":
            process_hour = str((int(process_hour) + 1) % 24)

    process_cron = f"{process_minute} {process_hour} {' '.join(process_parts[2:])}"
    process_trigger = CronTrigger(**parse_cron(process_cron))

    scheduler.add_job(
        process_job,
        trigger=process_trigger,
        id="process",
        name="Content Processing",
        replace_existing=True,
    )

    scheduler.add_job(
        digest_job,
        trigger=digest_trigger,
        id="digest",
        name="Digest Generation",
        replace_existing=True,
    )

    # Log schedule info
    logger.info("Scheduler started with jobs:")
    logger.info(f"  Ingest: {config.scheduler.ingest_cron}")
    logger.info(f"  Process: {process_cron}")
    logger.info(f"  Digest: {config.scheduler.digest_cron}")

    # Handle shutdown gracefully
    def shutdown(signum, frame):
        logger.info("Shutting down scheduler...")
        scheduler.shutdown(wait=False)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Start scheduler
    if foreground:
        logger.info("Running in foreground. Press Ctrl+C to stop.")
        try:
            scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            pass
    else:
        scheduler.start()
        logger.info("Scheduler running in background")
        return scheduler


def stop_scheduler(scheduler: Optional[BackgroundScheduler] = None):
    """Stop the scheduler.

    Args:
        scheduler: Scheduler instance to stop
    """
    if scheduler:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
