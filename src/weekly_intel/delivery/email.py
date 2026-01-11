"""Email delivery using Resend."""

import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional

import resend
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from weekly_intel.config import get_config
from weekly_intel.database import EmailLog, WeeklyDigest, get_session
from weekly_intel.digest.generator import DigestContent
from weekly_intel.digest.html import render_html_email, render_plain_text

logger = logging.getLogger(__name__)


@dataclass
class DeliveryResult:
    """Result of email delivery attempt."""

    success: bool
    recipient: str
    message_id: Optional[str] = None
    error: Optional[str] = None
    attempts: int = 1


class EmailDelivery:
    """Email delivery service using Resend."""

    def __init__(self):
        self.config = get_config()
        api_key = self.config.api_keys.resend
        if not api_key:
            raise ValueError("Resend API key not configured")

        resend.api_key = api_key

    @retry(
        retry=retry_if_exception_type((resend.exceptions.ResendError, ConnectionError)),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=4),
        reraise=True,
    )
    def _send_email(
        self,
        to: str,
        subject: str,
        html_content: str,
        text_content: str,
    ) -> dict:
        """Send email with retry logic.

        Args:
            to: Recipient email address
            subject: Email subject
            html_content: HTML body
            text_content: Plain text body

        Returns:
            Resend API response
        """
        params = {
            "from": self.config.email.from_address,
            "to": [to],
            "subject": subject,
            "html": html_content,
            "text": text_content,
            "headers": {},
        }

        # Add List-Unsubscribe header if configured
        if self.config.email.unsubscribe_url:
            params["headers"]["List-Unsubscribe"] = f"<{self.config.email.unsubscribe_url}>"
            params["headers"]["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

        return resend.Emails.send(params)

    def send_digest_email(
        self,
        content: DigestContent,
        recipient: str,
        digest_id: Optional[int] = None,
    ) -> DeliveryResult:
        """Send a digest email to a single recipient.

        Args:
            content: DigestContent to send
            recipient: Email address to send to
            digest_id: Optional database digest ID for logging

        Returns:
            DeliveryResult with success status
        """
        subject = f"Weekly Intel - Week of {content.date_range}"
        html_content = render_html_email(content)
        text_content = render_plain_text(content)

        attempts = 0
        message_id = None
        error = None

        try:
            response = self._send_email(recipient, subject, html_content, text_content)
            message_id = response.get("id")
            success = True
            attempts = 1  # May have retried internally
            logger.info(f"Email sent successfully to {recipient}, message_id={message_id}")

        except resend.exceptions.ResendError as e:
            success = False
            error = str(e)
            attempts = 3  # Max retries exhausted
            logger.error(f"Failed to send email to {recipient}: {e}")

        except Exception as e:
            success = False
            error = str(e)
            attempts = 1
            logger.error(f"Unexpected error sending to {recipient}: {e}")

        # Log to database
        if digest_id:
            self._log_delivery(
                digest_id=digest_id,
                recipient=recipient,
                success=success,
                message_id=message_id,
                attempts=attempts,
                error=error,
            )

        return DeliveryResult(
            success=success,
            recipient=recipient,
            message_id=message_id,
            error=error,
            attempts=attempts,
        )

    def send_digest_to_all(
        self,
        content: DigestContent,
        recipients: Optional[list[str]] = None,
        digest_id: Optional[int] = None,
    ) -> list[DeliveryResult]:
        """Send digest to all configured recipients.

        Args:
            content: DigestContent to send
            recipients: Optional list of recipients (uses config if not provided)
            digest_id: Optional database digest ID for logging

        Returns:
            List of DeliveryResults
        """
        if recipients is None:
            recipients = self.config.email.recipients

        if not recipients:
            logger.warning("No recipients configured for email delivery")
            return []

        results = []
        for recipient in recipients:
            result = self.send_digest_email(content, recipient, digest_id)
            results.append(result)

        success_count = sum(1 for r in results if r.success)
        logger.info(
            f"Email delivery complete: {success_count}/{len(results)} successful"
        )

        return results

    def _log_delivery(
        self,
        digest_id: int,
        recipient: str,
        success: bool,
        message_id: Optional[str],
        attempts: int,
        error: Optional[str],
    ) -> None:
        """Log delivery attempt to database."""
        with get_session() as session:
            log = EmailLog(
                digest_id=digest_id,
                recipient=recipient,
                status="sent" if success else "failed",
                provider_message_id=message_id,
                attempts=attempts,
                last_attempt_at=datetime.utcnow(),
                error_message=error,
            )
            session.add(log)


def send_digest(
    week_number: Optional[str] = None,
    recipients: Optional[list[str]] = None,
) -> list[DeliveryResult]:
    """Send a weekly digest email.

    Convenience function that loads the digest from file and sends it.

    Args:
        week_number: Week to send (YYYY-WW), defaults to current week
        recipients: Optional list of recipients

    Returns:
        List of DeliveryResults
    """
    config = get_config()

    if week_number is None:
        week_number = datetime.utcnow().strftime("%Y-%W")

    # Get digest from database
    with get_session() as session:
        digest = (
            session.query(WeeklyDigest)
            .filter_by(week_number=week_number)
            .first()
        )

        if not digest:
            logger.error(f"No digest found for week {week_number}")
            return []

        # Load HTML content
        html_path = Path(digest.html_path)
        if not html_path.exists():
            logger.error(f"Digest HTML file not found: {html_path}")
            return []

        with open(html_path) as f:
            html_content = f.read()

        # Load or generate plain text
        md_path = Path(digest.markdown_path)
        if md_path.exists():
            with open(md_path) as f:
                # Convert markdown to plain text (simple version)
                text_content = f.read()
        else:
            text_content = f"Weekly Intel Digest - {digest.date_range}"

        digest_id = digest.id

    # Create minimal content object for delivery
    content = DigestContent(
        week_number=week_number,
        date_range=digest.date_range if digest else week_number,
        sources_count=0,
        items_count=0,
        executive_summary=[],
        themes=[],
        hot_takes=[],
        signals_to_watch=[],
        source_index=[],
    )

    # Override render functions to use loaded content
    delivery = EmailDelivery()

    # Send to recipients
    if recipients is None:
        recipients = config.email.recipients

    results = []
    subject = f"Weekly Intel - Week of {content.date_range}"

    for recipient in recipients:
        try:
            response = delivery._send_email(
                to=recipient,
                subject=subject,
                html_content=html_content,
                text_content=text_content,
            )
            results.append(
                DeliveryResult(
                    success=True,
                    recipient=recipient,
                    message_id=response.get("id"),
                )
            )
            delivery._log_delivery(
                digest_id=digest_id,
                recipient=recipient,
                success=True,
                message_id=response.get("id"),
                attempts=1,
                error=None,
            )

        except Exception as e:
            results.append(
                DeliveryResult(
                    success=False,
                    recipient=recipient,
                    error=str(e),
                )
            )
            delivery._log_delivery(
                digest_id=digest_id,
                recipient=recipient,
                success=False,
                message_id=None,
                attempts=3,
                error=str(e),
            )

    return results
