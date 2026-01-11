"""HTML email digest renderer."""

from __future__ import annotations

import html
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from weekly_intel.digest.generator import DigestContent


def escape(text: str) -> str:
    """Escape HTML special characters."""
    return html.escape(str(text))


def render_html_email(content: DigestContent) -> str:
    """Render digest content as HTML email.

    Args:
        content: DigestContent to render

    Returns:
        HTML string with inline styles for email compatibility
    """
    # Build executive summary links
    exec_summary_html = ""
    for i, point in enumerate(content.executive_summary):
        exec_summary_html += f'<li><a href="#theme-{i+1}" style="color: #0066cc; text-decoration: none;">{escape(point)}</a></li>\n'

    # Build themes HTML
    themes_html = ""
    for i, theme in enumerate(content.themes, 1):
        novelty_class = "tag-new" if theme.is_novel else "tag-ongoing"
        novelty_text = "New" if theme.is_novel else "Ongoing"
        if theme.is_followup:
            novelty_class = "tag-ongoing"
            novelty_text = "Follow-up"

        sources_text = ", ".join(escape(s) for s in theme.sources)

        themes_html += f'''
    <section id="theme-{i}" class="section">
      <span class="{novelty_class}">{novelty_text}</span>
      <h3 style="margin-top: 8px; margin-bottom: 8px; color: #333;">{escape(theme.name)}</h3>
      <p style="margin: 0 0 12px 0; color: #444;">{escape(theme.synthesized_summary)}</p>
      <p class="sources">Sources: {sources_text}</p>
    </section>
'''

    # Build hot takes HTML
    hot_takes_html = ""
    if content.hot_takes:
        for take in content.hot_takes:
            hot_takes_html += f'''
      <div class="hot-take">
        <p style="margin: 0;"><strong>{escape(take.author)}</strong> ({escape(take.source)}): {escape(take.take)}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #666; font-style: italic;">{escape(take.assessment)}</p>
      </div>
'''

    # Wrap hot takes in section
    hot_takes_section = ""
    if content.hot_takes:
        hot_takes_section = f'''<section class="section">
      <h2 style="margin-top: 0; color: #333;">Hot Takes</h2>
{hot_takes_html}
    </section>'''

    # Build signals HTML
    signals_html = ""
    if content.signals_to_watch:
        signals_html = '<section class="section">\n      <h2 style="margin-top: 0; color: #333;">Signals to Watch</h2>\n      <ul style="margin: 0; padding-left: 20px;">\n'
        for signal in content.signals_to_watch:
            signals_html += f'        <li style="margin-bottom: 8px;">{escape(signal)}</li>\n'
        signals_html += '      </ul>\n    </section>'

    # Build source index HTML
    source_rows = ""
    for source in content.source_index:
        source_rows += f'''
        <tr>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{escape(source.name)}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: center;">{source.item_count}</td>
          <td style="padding: 8px; border-bottom: 1px solid #eee;">{escape(source.source_type)}</td>
        </tr>'''

    timestamp = content.generated_at.strftime("%Y-%m-%d %H:%M UTC")

    html_content = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>Weekly Intel - Week of {escape(content.date_range)}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    :root {{
      color-scheme: light dark;
      supported-color-schemes: light dark;
    }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }}
    .container {{
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }}
    .header {{
      text-align: center;
      padding-bottom: 20px;
      border-bottom: 2px solid #eee;
      margin-bottom: 20px;
    }}
    .header h1 {{
      margin: 0 0 8px 0;
      font-size: 28px;
      color: #333;
    }}
    .subtitle {{
      font-size: 14px;
      color: #666;
      margin: 0;
    }}
    .section {{
      background: #f8f9fa;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }}
    .executive-summary {{
      background: #e8f4fd;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }}
    .executive-summary h2 {{
      margin-top: 0;
      color: #333;
    }}
    .executive-summary ul {{
      margin: 0;
      padding-left: 20px;
    }}
    .executive-summary li {{
      margin-bottom: 8px;
    }}
    .tag-new {{
      display: inline-block;
      background: #d4edda;
      color: #155724;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }}
    .tag-ongoing {{
      display: inline-block;
      background: #fff3cd;
      color: #856404;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }}
    .hot-take {{
      border-left: 4px solid #dc3545;
      padding-left: 12px;
      margin: 12px 0;
    }}
    .sources {{
      font-size: 14px;
      color: #666;
      margin: 0;
    }}
    .source-table {{
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }}
    .source-table th {{
      background: #f1f3f4;
      padding: 10px 8px;
      text-align: left;
      font-size: 14px;
      border-bottom: 2px solid #ddd;
    }}
    .footer {{
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      text-align: center;
    }}
    .footer p {{
      font-size: 14px;
      color: #888;
      margin: 8px 0;
    }}
    .footer a {{
      color: #0066cc;
      text-decoration: none;
    }}
    @media (prefers-color-scheme: dark) {{
      body {{
        background: #1a1a1a;
        color: #e0e0e0;
      }}
      .header h1 {{
        color: #ffffff;
      }}
      .subtitle {{
        color: #aaa;
      }}
      .section {{
        background: #2d2d2d;
      }}
      .section h3 {{
        color: #ffffff !important;
      }}
      .section p {{
        color: #ccc !important;
      }}
      .executive-summary {{
        background: #1e3a5f;
      }}
      .executive-summary h2 {{
        color: #ffffff;
      }}
      .sources {{
        color: #aaa;
      }}
      .tag-new {{
        background: #1e4620;
        color: #a3d9a5;
      }}
      .tag-ongoing {{
        background: #5a4b00;
        color: #ffd93d;
      }}
      .footer p {{
        color: #888;
      }}
      .source-table th {{
        background: #333;
        color: #ddd;
      }}
      .source-table td {{
        color: #ccc;
        border-bottom-color: #444 !important;
      }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>Weekly Intel</h1>
      <p class="subtitle">Week of {escape(content.date_range)} | {content.sources_count} sources | {content.items_count} items</p>
    </header>

    <section class="executive-summary">
      <h2>This Week in 30 Seconds</h2>
      <ul>
{exec_summary_html}      </ul>
    </section>

    <h2 style="color: #333; margin-top: 30px;">Key Themes</h2>
{themes_html}

    {hot_takes_section}

    {signals_html}

    <section class="section">
      <h2 style="margin-top: 0; color: #333;">Source Index</h2>
      <table class="source-table">
        <thead>
          <tr>
            <th>Source</th>
            <th style="text-align: center;">Items</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
{source_rows}
        </tbody>
      </table>
    </section>

    <footer class="footer">
      <p>Generated {timestamp} by Weekly Intel</p>
      <p><a href="#">View archive</a> | <a href="#">Unsubscribe</a></p>
    </footer>
  </div>
</body>
</html>'''

    return html_content


def render_plain_text(content: DigestContent) -> str:
    """Render digest as plain text for email fallback.

    Args:
        content: DigestContent to render

    Returns:
        Plain text string
    """
    lines = []

    lines.append("WEEKLY INTEL DIGEST")
    lines.append(f"Week of {content.date_range}")
    lines.append(f"{content.sources_count} sources | {content.items_count} items")
    lines.append("")
    lines.append("=" * 50)
    lines.append("")

    # Executive Summary
    lines.append("THIS WEEK IN 30 SECONDS")
    lines.append("-" * 30)
    for point in content.executive_summary:
        lines.append(f"* {point}")
    lines.append("")

    # Themes
    lines.append("KEY THEMES")
    lines.append("-" * 30)
    for i, theme in enumerate(content.themes, 1):
        novelty = "[NEW]" if theme.is_novel else "[ONGOING]"
        if theme.is_followup:
            novelty = "[FOLLOW-UP]"
        lines.append(f"{i}. {novelty} {theme.name}")
        lines.append(f"   {theme.synthesized_summary}")
        lines.append(f"   Sources: {', '.join(theme.sources)}")
        lines.append("")

    # Hot Takes
    if content.hot_takes:
        lines.append("HOT TAKES")
        lines.append("-" * 30)
        for take in content.hot_takes:
            lines.append(f"* {take.author} ({take.source}): {take.take}")
            if take.assessment:
                lines.append(f"  Assessment: {take.assessment}")
        lines.append("")

    # Signals
    if content.signals_to_watch:
        lines.append("SIGNALS TO WATCH")
        lines.append("-" * 30)
        for signal in content.signals_to_watch:
            lines.append(f"* {signal}")
        lines.append("")

    # Footer
    lines.append("=" * 50)
    timestamp = content.generated_at.strftime("%Y-%m-%d %H:%M UTC")
    lines.append(f"Generated {timestamp} by Weekly Intel")

    return "\n".join(lines)
