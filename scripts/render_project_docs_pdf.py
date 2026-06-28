#!/usr/bin/env python3
"""Render Owmee project Markdown docs to shareable PDFs.

This is intentionally small and dependency-light. It supports the Markdown
subset used by the project architecture docs: headings, paragraphs, bullets,
tables, and fenced code blocks.
"""

from __future__ import annotations

import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
DOCS = [
    (
        ROOT / "docs" / "OWMEE_SYSTEM_ARCHITECTURE_AND_DESIGN.md",
        ROOT / "output" / "pdf" / "owmee_system_architecture_and_design.pdf",
    ),
    (
        ROOT / "docs" / "OWMEE_E2E_PRODUCT_AND_OPERATIONS_FLOW_DESIGN.md",
        ROOT / "output" / "pdf" / "owmee_e2e_product_and_operations_flow_design.pdf",
    ),
    (
        ROOT / "docs" / "OWMEE_OPERATIONS_INTEGRATIONS_AND_LAUNCH_READINESS.md",
        ROOT / "output" / "pdf" / "owmee_operations_integrations_and_launch_readiness.pdf",
    ),
]


def _styles():
    base = getSampleStyleSheet()
    brand = colors.HexColor("#245E56")
    ink = colors.HexColor("#172033")
    muted = colors.HexColor("#5E6A75")
    border = colors.HexColor("#DDEBE8")
    soft = colors.HexColor("#F1F8F6")
    cream = colors.HexColor("#FFF8EE")

    return {
        "brand": brand,
        "ink": ink,
        "muted": muted,
        "border": border,
        "soft": soft,
        "cream": cream,
        "title": ParagraphStyle(
            "OwmeeTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=24,
            leading=29,
            textColor=brand,
            alignment=TA_LEFT,
            spaceAfter=16,
        ),
        "h2": ParagraphStyle(
            "OwmeeH2",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14.5,
            leading=18,
            textColor=ink,
            spaceBefore=12,
            spaceAfter=7,
        ),
        "h3": ParagraphStyle(
            "OwmeeH3",
            parent=base["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11.8,
            leading=15,
            textColor=brand,
            spaceBefore=8,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "OwmeeBody",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.4,
            leading=13,
            textColor=ink,
            spaceAfter=6,
        ),
        "bullet": ParagraphStyle(
            "OwmeeBullet",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=9.1,
            leading=12.5,
            textColor=ink,
            leftIndent=0,
            firstLineIndent=0,
            spaceAfter=3,
        ),
        "code": ParagraphStyle(
            "OwmeeCode",
            parent=base["Code"],
            fontName="Courier",
            fontSize=7.5,
            leading=10,
            textColor=colors.HexColor("#243042"),
            backColor=colors.HexColor("#F7EFE7"),
            borderColor=border,
            borderWidth=0.3,
            borderPadding=5,
            leftIndent=0,
            rightIndent=0,
            spaceBefore=4,
            spaceAfter=8,
        ),
        "table_cell": ParagraphStyle(
            "OwmeeTableCell",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7.7,
            leading=9.8,
            textColor=ink,
        ),
        "table_head": ParagraphStyle(
            "OwmeeTableHead",
            parent=base["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.7,
            leading=9.8,
            textColor=colors.white,
        ),
        "footer": ParagraphStyle(
            "OwmeeFooter",
            parent=base["BodyText"],
            fontName="Helvetica",
            fontSize=7,
            leading=9,
            textColor=muted,
        ),
    }


def _clean_inline(text: str) -> str:
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    return text


def _split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _is_table(lines: list[str], idx: int) -> bool:
    return (
        idx + 1 < len(lines)
        and "|" in lines[idx]
        and re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$", lines[idx + 1])
    )


def _table_flow(table_lines: list[str], st: dict, available_width: float):
    rows = [_split_table_row(line) for line in table_lines if line.strip()]
    if len(rows) < 2:
        return []
    header = rows[0]
    data_rows = rows[2:]
    col_count = max(len(header), *(len(row) for row in data_rows)) if data_rows else len(header)
    normalized = []
    normalized.append([
        Paragraph(_clean_inline((header + [""] * col_count)[i]), st["table_head"])
        for i in range(col_count)
    ])
    for row in data_rows:
        normalized.append([
            Paragraph(_clean_inline((row + [""] * col_count)[i]), st["table_cell"])
            for i in range(col_count)
        ])

    col_width = available_width / max(col_count, 1)
    table = Table(normalized, colWidths=[col_width] * col_count, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), st["brand"]),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.25, st["border"]),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return [table, Spacer(1, 8)]


def _list_items(items: list[str], st: dict, *, ordered: bool = False):
    flow_items = [
        ListItem(Paragraph(_clean_inline(item), st["bullet"]), leftIndent=10)
        for item in items
    ]
    return ListFlowable(
        flow_items,
        bulletType="1" if ordered else "bullet",
        start="1" if ordered else "circle",
        leftIndent=18 if ordered else 14,
        bulletFontSize=8 if ordered else 5,
        bulletOffsetY=1,
        spaceAfter=6,
    )


def _markdown_to_flowables(markdown: str, st: dict, available_width: float):
    lines = markdown.splitlines()
    flows = []
    idx = 0
    in_code = False
    code_lines: list[str] = []
    bullet_buffer: list[str] = []
    ordered_buffer: list[str] = []

    def flush_bullets():
        nonlocal bullet_buffer, ordered_buffer
        if bullet_buffer:
            flows.append(_list_items(bullet_buffer, st, ordered=False))
            bullet_buffer = []
        if ordered_buffer:
            flows.append(_list_items(ordered_buffer, st, ordered=True))
            ordered_buffer = []

    while idx < len(lines):
        line = lines[idx]
        stripped = line.strip()

        if stripped.startswith("```"):
            flush_bullets()
            if not in_code:
                in_code = True
                code_lines = []
            else:
                in_code = False
                flows.append(Preformatted("\n".join(code_lines), st["code"], maxLineLength=92))
            idx += 1
            continue

        if in_code:
            code_lines.append(line)
            idx += 1
            continue

        if not stripped:
            flush_bullets()
            idx += 1
            continue

        if stripped == "<!-- pagebreak -->":
            flush_bullets()
            flows.append(PageBreak())
            idx += 1
            continue

        if _is_table(lines, idx):
            flush_bullets()
            table_lines = []
            while idx < len(lines) and "|" in lines[idx] and lines[idx].strip():
                table_lines.append(lines[idx])
                idx += 1
            flows.extend(_table_flow(table_lines, st, available_width))
            continue

        if stripped.startswith("- "):
            if ordered_buffer:
                flows.append(_list_items(ordered_buffer, st, ordered=True))
                ordered_buffer = []
            bullet_buffer.append(stripped[2:].strip())
            idx += 1
            continue

        ordered_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if ordered_match:
            if bullet_buffer:
                flows.append(_list_items(bullet_buffer, st, ordered=False))
                bullet_buffer = []
            ordered_buffer.append(ordered_match.group(1).strip())
            idx += 1
            continue

        if (bullet_buffer or ordered_buffer) and not (
            stripped.startswith("#")
            or stripped.startswith("- ")
            or stripped.startswith("```")
            or _is_table(lines, idx)
            or re.match(r"^\d+\.\s+", stripped)
        ):
            if ordered_buffer:
                ordered_buffer[-1] = f"{ordered_buffer[-1]} {stripped}"
            else:
                bullet_buffer[-1] = f"{bullet_buffer[-1]} {stripped}"
            idx += 1
            continue

        flush_bullets()

        if stripped.startswith("# "):
            flows.append(Paragraph(_clean_inline(stripped[2:]), st["title"]))
        elif stripped.startswith("## "):
            flows.append(Paragraph(_clean_inline(stripped[3:]), st["h2"]))
        elif stripped.startswith("### "):
            flows.append(Paragraph(_clean_inline(stripped[4:]), st["h3"]))
        else:
            para_lines = [stripped]
            idx += 1
            while idx < len(lines):
                nxt = lines[idx].strip()
                if (
                    not nxt
                    or nxt.startswith("#")
                    or nxt.startswith("- ")
                    or re.match(r"^\d+\.\s+", nxt)
                    or nxt.startswith("```")
                    or _is_table(lines, idx)
                ):
                    break
                para_lines.append(nxt)
                idx += 1
            flows.append(Paragraph(_clean_inline(" ".join(para_lines)), st["body"]))
            continue
        idx += 1

    flush_bullets()
    return flows


class OwmeeDocTemplate(BaseDocTemplate):
    def __init__(self, filename: Path, title: str, styles: dict):
        self.title_text = title
        self.styles = styles
        super().__init__(
            str(filename),
            pagesize=A4,
            leftMargin=0.55 * inch,
            rightMargin=0.55 * inch,
            topMargin=0.62 * inch,
            bottomMargin=0.58 * inch,
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="normal",
        )
        self.addPageTemplates([PageTemplate(id="owmee", frames=[frame], onPage=self._page)])

    def _page(self, canvas, doc):
        canvas.saveState()
        width, height = A4
        canvas.setStrokeColor(self.styles["border"])
        canvas.setLineWidth(0.5)
        canvas.line(self.leftMargin, height - 0.42 * inch, width - self.rightMargin, height - 0.42 * inch)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(self.styles["brand"])
        canvas.drawString(self.leftMargin, height - 0.32 * inch, "Owmee")
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(self.styles["muted"])
        canvas.drawRightString(width - self.rightMargin, height - 0.32 * inch, self.title_text[:80])
        canvas.line(self.leftMargin, 0.42 * inch, width - self.rightMargin, 0.42 * inch)
        canvas.drawString(self.leftMargin, 0.27 * inch, "Generated from project docs")
        canvas.drawRightString(width - self.rightMargin, 0.27 * inch, f"Page {doc.page}")
        canvas.restoreState()


def _title_from_markdown(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def render_doc(source: Path, target: Path) -> None:
    st = _styles()
    target.parent.mkdir(parents=True, exist_ok=True)
    markdown = source.read_text(encoding="utf-8")
    title = _title_from_markdown(markdown, source.stem.replace("_", " ").title())
    doc = OwmeeDocTemplate(target, title, st)
    flows = _markdown_to_flowables(markdown, st, doc.width)
    doc.build(flows)


def main() -> None:
    for source, target in DOCS:
        render_doc(source, target)
        print(f"rendered {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
