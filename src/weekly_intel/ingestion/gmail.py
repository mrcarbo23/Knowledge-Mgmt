"""Gmail newsletter ingestor with OAuth support."""

import base64
import logging
import pickle
from datetime import datetime
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from weekly_intel.config import get_config
from weekly_intel.database import ContentItem, get_session
from weekly_intel.ingestion.base import BaseIngestor, ContentData, IngestResult

logger = logging.getLogger(__name__)

# Gmail API scopes - read-only access
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


class GmailIngestor(BaseIngestor):
    """Ingestor for Gmail newsletters."""

    source_type = "gmail"

    def __init__(self, source_id: int, config: dict):
        super().__init__(source_id, config)
        self._service = None

    def validate_config(self) -> list[str]:
        """Validate Gmail configuration."""
        errors = []
        app_config = get_config()

        # Check for credentials file
        creds_path = Path(app_config.gmail.credentials_path)
        if not creds_path.exists():
            errors.append(
                f"Gmail credentials file not found: {creds_path}. "
                "Download from Google Cloud Console."
            )

        # Need either label or senders to filter
        if not self.config.get("label") and not self.config.get("senders"):
            errors.append("Gmail source requires 'label' or 'senders' in config")

        return errors

    def get_credentials(self) -> Optional[Credentials]:
        """Get or refresh Gmail OAuth credentials."""
        app_config = get_config()
        token_path = Path(app_config.gmail.token_path)
        creds_path = Path(app_config.gmail.credentials_path)

        creds = None

        # Load existing token
        if token_path.exists():
            with open(token_path, "rb") as token:
                creds = pickle.load(token)

        # Refresh or get new credentials
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                logger.info("Refreshing Gmail credentials")
                creds.refresh(Request())
            else:
                # This requires user interaction (browser)
                logger.info("Starting Gmail OAuth flow")
                flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
                creds = flow.run_local_server(port=0)

            # Save credentials
            token_path.parent.mkdir(parents=True, exist_ok=True)
            with open(token_path, "wb") as token:
                pickle.dump(creds, token)

        return creds

    def get_service(self):
        """Get or create Gmail API service."""
        if self._service is None:
            creds = self.get_credentials()
            if creds:
                self._service = build("gmail", "v1", credentials=creds)
        return self._service

    def _build_query(self) -> str:
        """Build Gmail search query from config."""
        parts = []

        # Filter by label
        label = self.config.get("label")
        if label:
            parts.append(f"label:{label}")

        # Filter by senders
        senders = self.config.get("senders", [])
        if senders:
            sender_query = " OR ".join(f"from:{sender}" for sender in senders)
            if len(senders) > 1:
                sender_query = f"({sender_query})"
            parts.append(sender_query)

        # Only get unread or recent (last 7 days by default)
        days = self.config.get("days_back", 7)
        parts.append(f"newer_than:{days}d")

        return " ".join(parts)

    def fetch_items(self) -> list[ContentData]:
        """Fetch newsletter items from Gmail."""
        service = self.get_service()
        if not service:
            logger.error("Failed to get Gmail service")
            return []

        app_config = get_config()
        query = self._build_query()
        logger.info(f"Gmail query: {query}")

        items = []
        page_token = None

        while True:
            results = (
                service.users()
                .messages()
                .list(
                    userId="me",
                    q=query,
                    maxResults=min(app_config.gmail.max_results, 100),
                    pageToken=page_token,
                )
                .execute()
            )

            messages = results.get("messages", [])
            logger.info(f"Found {len(messages)} messages in page")

            for msg_info in messages:
                msg_data = self._fetch_message(service, msg_info["id"])
                if msg_data:
                    items.append(msg_data)

                if len(items) >= app_config.gmail.max_results:
                    break

            page_token = results.get("nextPageToken")
            if not page_token or len(items) >= app_config.gmail.max_results:
                break

        logger.info(f"Fetched {len(items)} newsletter items")
        return items

    def _fetch_message(self, service, message_id: str) -> Optional[ContentData]:
        """Fetch and parse a single message."""
        try:
            msg = service.users().messages().get(userId="me", id=message_id, format="full").execute()

            # Extract headers
            headers = {h["name"].lower(): h["value"] for h in msg["payload"]["headers"]}

            external_id = message_id
            title = headers.get("subject", "No Subject")
            author = headers.get("from", "Unknown")

            # Parse date
            published_at = None
            date_str = headers.get("date")
            if date_str:
                try:
                    from email.utils import parsedate_to_datetime

                    published_at = parsedate_to_datetime(date_str)
                except Exception:
                    pass

            # Extract body
            content_html, content_text = self._extract_body(msg["payload"])

            return ContentData(
                external_id=external_id,
                title=title,
                author=author,
                content_text=content_text,
                content_html=content_html,
                url=None,  # Emails don't have URLs
                published_at=published_at,
            )

        except Exception as e:
            logger.error(f"Failed to fetch message {message_id}: {e}")
            return None

    def _extract_body(self, payload: dict) -> tuple[Optional[str], Optional[str]]:
        """Extract HTML and text body from message payload."""
        html_body = None
        text_body = None

        def process_part(part):
            nonlocal html_body, text_body

            mime_type = part.get("mimeType", "")

            if "parts" in part:
                for subpart in part["parts"]:
                    process_part(subpart)
            elif "body" in part and "data" in part["body"]:
                data = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")

                if mime_type == "text/html" and not html_body:
                    html_body = data
                elif mime_type == "text/plain" and not text_body:
                    text_body = data

        process_part(payload)

        # Convert HTML to text if no plain text
        if html_body and not text_body:
            text_body = self._html_to_text(html_body)

        return html_body, text_body

    def _html_to_text(self, html: str) -> str:
        """Convert HTML to plain text."""
        soup = BeautifulSoup(html, "html.parser")

        # Remove script and style elements
        for element in soup(["script", "style"]):
            element.decompose()

        text = soup.get_text(separator=" ", strip=True)
        return " ".join(text.split())

    def ingest(self) -> IngestResult:
        """Ingest newsletters from Gmail."""
        result = IngestResult(source_id=self.source_id)

        # Validate config
        errors = self.validate_config()
        if errors:
            result.errors = errors
            return result

        try:
            items = self.fetch_items()
            result.items_found = len(items)
        except Exception as e:
            logger.error(f"Failed to fetch Gmail: {e}")
            result.errors.append(f"Failed to fetch Gmail: {e}")
            return result

        # Store items in database
        with get_session() as session:
            for item in items:
                try:
                    existing = (
                        session.query(ContentItem)
                        .filter_by(source_id=self.source_id, external_id=item.external_id)
                        .first()
                    )

                    if existing:
                        result.items_skipped += 1
                        continue

                    content_item = ContentItem(
                        source_id=self.source_id,
                        external_id=item.external_id,
                        title=item.title,
                        author=item.author,
                        content_text=item.content_text,
                        content_html=item.content_html,
                        url=item.url,
                        published_at=item.published_at,
                    )
                    session.add(content_item)
                    result.items_new += 1

                except Exception as e:
                    logger.error(f"Failed to store item {item.external_id}: {e}")
                    result.items_failed += 1
                    result.errors.append(f"Failed to store {item.title}: {e}")

        logger.info(
            f"Gmail ingestion complete: {result.items_new} new, "
            f"{result.items_skipped} skipped, {result.items_failed} failed"
        )
        return result


def run_oauth_flow() -> bool:
    """Run OAuth flow interactively (for CLI command)."""
    app_config = get_config()
    creds_path = Path(app_config.gmail.credentials_path)

    if not creds_path.exists():
        print(f"Error: Credentials file not found: {creds_path}")
        print("Download OAuth credentials from Google Cloud Console.")
        return False

    try:
        flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
        creds = flow.run_local_server(port=0)

        token_path = Path(app_config.gmail.token_path)
        token_path.parent.mkdir(parents=True, exist_ok=True)
        with open(token_path, "wb") as token:
            pickle.dump(creds, token)

        print(f"Gmail OAuth successful! Token saved to {token_path}")
        return True

    except Exception as e:
        print(f"OAuth flow failed: {e}")
        return False
