# Weekly Intel

A knowledge management application that ingests content from multiple sources and produces weekly intelligence digests.

## Features

- **Multi-source ingestion**: Substack RSS feeds, Gmail newsletters, YouTube transcripts
- **Smart deduplication**: 4-layer deduplication using MinHash, embeddings, clustering, and historical novelty checking
- **LLM-powered extraction**: Uses Claude to extract summaries, key information, themes, and contrarian views
- **Weekly digests**: Generates Markdown and HTML email formats
- **Email delivery**: Send digests via Resend with retry logic

## Installation

```bash
pip install -e .
```

## Quick Start

```bash
# Initialize database and config
weekly-intel init

# Edit config.yaml with your Anthropic API key

# Add a content source
weekly-intel source add substack --name "Stratechery" --url "https://stratechery.com/feed/"

# Ingest content
weekly-intel ingest

# Process with LLM
weekly-intel process

# Generate digest
weekly-intel digest
```

## Configuration

Copy `config.example.yaml` to `config.yaml` and configure:

- `api_keys.anthropic`: Your Anthropic API key (required)
- `api_keys.resend`: Resend API key for email delivery (optional)
- `email.recipients`: List of email addresses for digest delivery

## CLI Commands

```bash
weekly-intel init              # Initialize database and config
weekly-intel source add        # Add content source
weekly-intel source list       # List configured sources
weekly-intel source remove     # Remove a source
weekly-intel ingest            # Ingest from all sources
weekly-intel process           # Run LLM processing pipeline
weekly-intel digest            # Generate weekly digest
weekly-intel digest --send     # Generate and email digest
weekly-intel gmail auth        # Run Gmail OAuth flow
weekly-intel scheduler start   # Start scheduled daemon
weekly-intel stats             # Show database statistics
```

## Requirements

- Python 3.11+
- Anthropic API key for Claude
- Optional: Resend API key for email delivery
- Optional: Google Cloud credentials for Gmail integration
