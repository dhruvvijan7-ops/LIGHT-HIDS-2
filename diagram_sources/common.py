"""Shared drawing helpers for the Sentinel use-case / DFD diagrams.

Notation (Gane-Sarson style for the DFDs):
  * external entity  - square with a heavy border
  * process          - rounded rectangle with an ID band on top
  * data store       - open-ended rectangle with an ID cell (D1..D6)
  * data flow        - labeled straight/segmented arrow

UML (use-case diagram):
  * stick-figure actor, ellipse use cases, system boundary rectangle,
    <<include>> dashed dependency arrows.

Palette (restrained cybersecurity style):
  navy #1F2A44 borders/text, blue #2563EB accents, neutral fills.
"""

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle, Ellipse, Circle, FancyArrowPatch, PathPatch
from matplotlib.path import Path
import matplotlib.patches as mpatches

NAVY = "#1F2A44"
BLUE = "#2563EB"
MID = "#4C6EF5"
FILL_PROCESS = "#EAF0FB"
FILL_ENTITY = "#D8DEE9"
FILL_STORE = "#F1F3F7"
FILL_ACTOR = "#FFFFFF"
GREY = "#6B7280"

LINE_W = 1.6
FS_LABEL = 8.2
FS_TITLE = 15


def new_canvas(w=16, h=9, title=None):
    fig, ax = plt.subplots(figsize=(w, h), dpi=120)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.set_aspect("auto")
    ax.axis("off")
    if title:
        ax.text(50, 98.4, title, ha="center", va="top",
                fontsize=FS_TITLE, fontweight="bold", color=NAVY)
    return fig, ax


def external_entity(ax, cx, cy, w, h, label):
    """Square external entity."""
    ax.add_patch(Rectangle((cx - w / 2, cy - h / 2), w, h,
                           facecolor=FILL_ENTITY, edgecolor=NAVY, lw=LINE_W, zorder=3))
    ax.text(cx, cy, label, ha="center", va="center", fontsize=FS_LABEL,
            color=NAVY, fontweight="bold", zorder=4, linespacing=1.4)


def process(ax, cx, cy, w, h, pid, label, fill=FILL_PROCESS):
    """Gane-Sarson rounded rectangle process with ID band."""
    box = FancyBboxPatch((cx - w / 2, cy - h / 2), w, h,
                         boxstyle="round,pad=0,rounding_size=2.2",
                         facecolor=fill, edgecolor=NAVY, lw=LINE_W, zorder=3)
    ax.add_patch(box)
    # ID band
    band_h = min(5.0, h * 0.28)
    ax.add_patch(Rectangle((cx - w / 2, cy + h / 2 - band_h), w, band_h,
                           facecolor=NAVY, edgecolor=NAVY, lw=0, zorder=4))
    ax.text(cx - w / 2 + band_h / 2, cy + h / 2 - band_h / 2, pid, ha="center",
            va="center", fontsize=9.5, color="white", fontweight="bold", zorder=5)
    band_right = band_h
    ax.plot([cx - w / 2 + band_right, cx - w / 2 + band_right],
            [cy + h / 2, cy + h / 2 - band_h], color="white", lw=1.2, zorder=5)
    ax.text(cx + band_right, cy + h / 2 - band_h - 1.0, label, ha="center",
            va="top", fontsize=FS_LABEL, color=NAVY, fontweight="bold", zorder=5,
            linespacing=1.35)


def dataframe_box(ax, cx, cy, w, h, sid, label):
    """Gane-Sarson open-ended data store."""
    left = cx - w / 2
    ax.add_patch(Rectangle((left, cy - h / 2), w, h, facecolor=FILL_STORE,
                           edgecolor=NAVY, lw=LINE_W, zorder=3))
    ax.plot([left, left], [cy - h / 2, cy + h / 2], color=NAVY, lw=2.6, zorder=4)
    ax.plot([left + w, left + w], [cy - h / 2, cy + h / 2], color=NAVY, lw=0, zorder=4)
    # ID cell
    ax.plot([left + 7, left + 7], [cy - h / 2, cy + h / 2], color=NAVY, lw=1.2, zorder=4)
    ax.text(left + 3.5, cy, sid, ha="center", va="center", fontsize=9,
            color=NAVY, fontweight="bold", zorder=4)
    ax.text(left + 7 + (w - 7) / 2, cy, label, ha="center", va="center",
            fontsize=FS_LABEL, color=NAVY, zorder=4, linespacing=1.35)


def flow(ax, points, label=None, color=NAVY, dashed=False, label_pos=None,
         label_dx=0, label_dy=0.9, rad=0.0, lw=LINE_W):
    """Labeled arrow through a list of points (may be curved with rad)."""
    verts = list(points)
    codes = [Path.MOVETO] + [Path.LINETO] * (len(verts) - 1)
    path = Path(verts, codes)
    ax.add_patch(PathPatch(path, fill=False, edgecolor=color, lw=lw,
                           linestyle=(0, (4, 3)) if dashed else "-", zorder=2,
                           joinstyle="miter"))
    # arrowhead at last segment
    x0, y0 = verts[-2]
    x1, y1 = verts[-1]
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>",
                                 mutation_scale=15, color=color, lw=lw, zorder=2,
                                 shrinkA=0, shrinkB=0))
    if label:
        if label_pos is None:
            lx, ly = verts[len(verts) // 2 - 1] if len(verts) > 2 else verts[0]
        else:
            lx, ly = label_pos
        ax.text(lx + label_dx, ly + label_dy, label, ha="center", va="bottom",
                fontsize=7.6, color=color, zorder=6, linespacing=1.25,
                bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.85))


def actor(ax, cx, cy, scale=1.0, name=None, color=NAVY):
    """Stick figure with name underneath."""
    s = scale
    ax.add_patch(Circle((cx, cy + 2.6), 0.95, fill=False, ec=color, lw=1.6, zorder=3))
    ax.plot([cx, cx], [cy + 1.65, cy + 0.4], color=color, lw=1.6, zorder=3)   # body
    ax.plot([cx - 1.05, cx + 1.05], [cy + 1.35, cy + 1.35], color=color, lw=1.6, zorder=3)  # arms
    ax.plot([cx, cx - 0.75], [cy + 0.4, cy - 0.6], color=color, lw=1.6, zorder=3)  # leg L
    ax.plot([cx, cx + 0.75], [cy + 0.4, cy - 0.6], color=color, lw=1.6, zorder=3)  # leg R
    if name:
        ax.text(cx, cy - 1.15, name, ha="center", va="top", fontsize=8.6,
                color=color, fontweight="bold", linespacing=1.3, zorder=3)


def usecase(ax, cx, cy, w, h, text, fill=FILL_PROCESS):
    ax.add_patch(Ellipse((cx, cy), w, h, facecolor=fill, edgecolor=NAVY,
                         lw=1.4, zorder=3))
    ax.text(cx, cy, text, ha="center", va="center", fontsize=7.8, color=NAVY,
            fontweight="bold", linespacing=1.3, zorder=4)


def connector(ax, x0, y0, x1, y1, color=NAVY):
    ax.plot([x0, x1], [y0, y1], color=color, lw=1.1, zorder=1, alpha=0.85)


def deps_arrow(ax, x0, y0, x1, y1, stereotype="include", label_dx=0.0, label_dy=0.0):
    """Dashed UML dependency arrow for <<include>>/<<extend>>."""
    ax.add_patch(FancyArrowPatch((x0, y0), (x1, y1), arrowstyle="-|>",
                                 mutation_scale=14, linestyle=(0, (5, 3)),
                                 color=GREY, lw=1.2, zorder=2))
    mx, my = (x0 + x1) / 2 + label_dx, (y0 + y1) / 2 + label_dy
    ax.text(mx, my, f"\u00ab{stereotype}\u00bb", ha="center", va="bottom",
            fontsize=7.2, color=GREY, zorder=6, style="italic",
            bbox=dict(boxstyle="round,pad=0.15", fc="white", ec="none", alpha=0.9))


def legend(ax, x, y, entries, title=None):
    if title:
        ax.text(x, y, title, ha="left", va="bottom", fontsize=8.4,
                color=NAVY, fontweight="bold")
        y -= 2.6
    ax.text(x, y, entries, ha="left", va="top", fontsize=7.6, color=GREY,
            linespacing=1.55)


def save(fig, base, png_dpi=240):
    """Save SVG (editable vector) + PNG. Returns (svg_path, png_path)."""
    svg = base + ".svg"
    png = base + ".png"
    fig.savefig(svg, bbox_inches="tight", pad_inches=0.15,
                facecolor=fig.get_facecolor())
    fig.savefig(png, dpi=png_dpi, bbox_inches="tight", pad_inches=0.15,
                facecolor=fig.get_facecolor())
    plt.close(fig)
    return svg, png
