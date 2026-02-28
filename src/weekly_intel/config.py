"""Configuration loading and validation."""

from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class DatabaseConfig(BaseModel):
    """Database configuration."""

    path: str = "data/weekly_intel.db"


class ApiKeysConfig(BaseModel):
    """API keys configuration."""

    anthropic: Optional[str] = None
    resend: Optional[str] = None


class EmailConfig(BaseModel):
    """Email delivery configuration."""

    enabled: bool = False
    from_address: str = "Weekly Intel <digest@example.com>"
    recipients: list[str] = Field(default_factory=list)
    unsubscribe_url: str = ""


class GmailConfig(BaseModel):
    """Gmail OAuth configuration."""

    credentials_path: str = "data/gmail_credentials.json"
    token_path: str = "data/gmail_token.json"
    label: Optional[str] = "Newsletters"
    max_results: int = 50


class ProcessingConfig(BaseModel):
    """Processing pipeline configuration."""

    model: str = "claude-sonnet-4-20250514"
    embedding_model: str = "all-MiniLM-L6-v2"
    fingerprint_threshold: float = 0.8
    semantic_threshold: float = 0.85
    novelty_weeks: int = 4


class SchedulerConfig(BaseModel):
    """Scheduler configuration."""

    ingest_cron: str = "0 6 * * *"
    digest_cron: str = "0 8 * * 0"
    auto_send: bool = False


class OutputConfig(BaseModel):
    """Output configuration."""

    digest_dir: str = "output/digests"


class ExtractionPromptsConfig(BaseModel):
    """Prompts for content extraction."""

    system_prompt: str = ""
    user_prompt_template: str = ""


class SynthesisPromptsConfig(BaseModel):
    """Prompts for digest synthesis."""

    system_prompt: str = ""
    cluster_system_prompt: str = ""
    cluster_user_prompt_template: str = ""
    executive_summary_prompt_template: str = ""


class PromptsConfig(BaseModel):
    """All LLM prompt configuration."""

    extraction: ExtractionPromptsConfig = Field(default_factory=ExtractionPromptsConfig)
    synthesis: SynthesisPromptsConfig = Field(default_factory=SynthesisPromptsConfig)

    @classmethod
    def from_yaml(cls, path: Path | str) -> "PromptsConfig":
        """Load prompts from a YAML file."""
        path = Path(path)
        if not path.exists():
            return cls()

        with open(path) as f:
            data = yaml.safe_load(f) or {}

        return cls(**data)


class Config(BaseSettings):
    """Main application configuration."""

    model_config = SettingsConfigDict(
        env_prefix="WEEKLY_INTEL_",
        env_nested_delimiter="__",
    )

    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    api_keys: ApiKeysConfig = Field(default_factory=ApiKeysConfig)
    email: EmailConfig = Field(default_factory=EmailConfig)
    gmail: GmailConfig = Field(default_factory=GmailConfig)
    processing: ProcessingConfig = Field(default_factory=ProcessingConfig)
    scheduler: SchedulerConfig = Field(default_factory=SchedulerConfig)
    output: OutputConfig = Field(default_factory=OutputConfig)
    prompts: PromptsConfig = Field(default_factory=PromptsConfig)

    @classmethod
    def from_yaml(cls, path: Path | str) -> "Config":
        """Load configuration from a YAML file."""
        path = Path(path)
        if not path.exists():
            return cls()

        with open(path) as f:
            data = yaml.safe_load(f) or {}

        return cls(**data)


# Global config instance
_config: Optional[Config] = None


def get_config() -> Config:
    """Get the global configuration instance."""
    global _config
    if _config is None:
        _config = load_config()
    return _config


def load_config(path: Optional[Path | str] = None) -> Config:
    """Load configuration from file or defaults."""
    global _config

    if path is None:
        # Look for config.yaml in current directory or parent directories
        search_paths = [
            Path.cwd() / "config.yaml",
            Path.cwd() / "config.yml",
            Path.home() / ".config" / "weekly-intel" / "config.yaml",
        ]
        for search_path in search_paths:
            if search_path.exists():
                path = search_path
                break

    if path:
        _config = Config.from_yaml(path)
    else:
        _config = Config()

    # Load prompts from prompts.yaml alongside the config file
    if path:
        prompts_path = Path(path).parent / "prompts.yaml"
    else:
        prompts_path = Path.cwd() / "prompts.yaml"

    if prompts_path.exists():
        _config.prompts = PromptsConfig.from_yaml(prompts_path)

    return _config


def set_config(config: Config) -> None:
    """Set the global configuration instance."""
    global _config
    _config = config
