"""Sentinel — UML Use Case Diagram (rebuilt, collision-free layout).

Layout:
  * Security Analyst fan connects only to the LEFT column of use cases.
  * System/Rule Administrator fan connects only to the RIGHT column.
  * UC-01 Authenticate sits top-center; both actors reach it via elbow
    routes through the top corridor (no ellipse crossings).
  * UC-13 (review audit) is reached by the admin through a bottom corridor.
  * «include» dependencies: UC-02 -> UC-03, UC-09 -> UC-10.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import matplotlib.pyplot as plt
from matplotlib.path import Path
from matplotlib.patches import PathPatch, FancyArrowPatch
from common import *

W, H = 23.0, 6.4
LCX, RCX = 42.0, 76.0               # column centers
rows = [77.5, 69.0, 60.5, 52.0, 43.5, 35.0, 26.5, 18.0]

fig, ax = new_canvas(17.0, 10.2, None)

# ---- system boundary -------------------------------------------------------
bx, by, bw, bh = 29, 10, 60, 82
ax.add_patch(Rectangle((bx, by), bw, bh, facecolor="#FAFBFE",
                       edgecolor=NAVY, lw=2.2, zorder=1))
ax.text(bx + bw / 2, by + bh - 1.6, "Sentinel Security Analysis Platform",
        ha="center", va="top", fontsize=12, fontweight="bold", color=NAVY, zorder=5)

# ---- actors ----------------------------------------------------------------
actor(ax, 12, 49, scale=1.4, name="Security Analyst\n(works via React console)")
actor(ax, 95, 56.5, scale=1.4, name="System Administrator /\nRule Administrator")

# ---- use cases -------------------------------------------------------------
left = {   # analyst-owned
    "UC-02": (LCX, rows[0], "Upload Security Artifact"),
    "UC-04": (LCX, rows[1], "Start Analysis"),
    "UC-06": (LCX, rows[2], "View Findings"),
    "UC-08": (LCX, rows[3], "Inspect Evidence and Timeline"),
    "UC-05": (LCX, rows[4], "View Analysis Status"),
    "UC-07": (LCX, rows[5], "Investigate Finding"),
    "UC-11": (LCX, rows[6], "Review Analysis Errors"),
    "UC-13": (LCX, rows[7], "Review Audit Records"),
}
right = {  # admin-owned
    "UC-09": (RCX, rows[1], "Manage Detection Rules"),
    "UC-10": (RCX, rows[2], "Validate and Test Rules"),
    "UC-12": (RCX, rows[4], "Manage Users and Workspaces"),
    "UC-03": (RCX, rows[0], "Validate Artifact\nsystem-executed"),
}
UC01 = (59.0, 85.0)

for pid, (cx, cy, label) in left.items():
    usecase(ax, cx, cy, W, H, f"{pid}\n{label}")
for pid, (cx, cy, label) in right.items():
    usecase(ax, cx, cy, W, H, f"{pid}\n{label}")
usecase(ax, UC01[0], UC01[1], 19.5, 6.2, "UC-01\nAuthenticate")

# ---- analyst fan (left column only) ----------------------------------------
ax_y = 49
for pid in ["UC-02", "UC-04", "UC-06", "UC-08", "UC-05", "UC-07", "UC-11", "UC-13"]:
    cx, cy, _ = left[pid]
    connector(ax, 13.5, ax_y, cx - W / 2, cy)

# ---- admin fan (right column only) -----------------------------------------
ad_x, ad_y = 95, 56.5
for pid in ["UC-03", "UC-09", "UC-10", "UC-12"]:
    cx, cy, _ = right[pid]
    connector(ax, ad_x - 1.6, ad_y, cx + W / 2, cy)

# ---- elbow: analyst -> UC-01 (corridor above the boundary top edge) --------
CORR = 94.6
pts = [(13.5, ax_y), (13.5, CORR), (59.0, CORR), (59.0, UC01[1] + 3.15)]
verts, codes = pts, [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1)
ax.add_patch(PathPatch(Path(verts, codes), fill=False, ec=NAVY, lw=1.1, zorder=1))

# ---- elbow: admin -> UC-01 (same corridor, non-overlapping span) ------------
pts = [(95, ad_y), (95, CORR), (66.6, CORR), (66.6, UC01[1] + 3.15)]
verts, codes = pts, [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1)
ax.add_patch(PathPatch(Path(verts, codes), fill=False, ec=NAVY, lw=1.1, zorder=1))

# ---- elbow: admin -> UC-13 (bottom corridor, right edge of ellipse) --------
t13 = left["UC-13"]
pts = [(95, ad_y - 1.2), (95, 13.0), (56.6, 13.0), (56.6, t13[1]), (t13[0] + W / 2, t13[1])]
verts, codes = pts, [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1)
ax.add_patch(PathPatch(Path(verts, codes), fill=False, ec=NAVY, lw=1.1, zorder=1))
ax.add_patch(FancyArrowPatch(verts[-2], verts[-1], arrowstyle="-",
                             mutation_scale=1, color=NAVY, lw=1.1, zorder=1))

# ---- «include» dependencies -------------------------------------------------
a, b = left["UC-02"], right["UC-03"]
deps_arrow(ax, a[0] + W / 2 + 0.5, a[1], b[0] - W / 2 - 0.5, b[1], "include")
a, b2 = right["UC-09"], right["UC-10"]
deps_arrow(ax, a[0] + 6.3, a[1] - H / 2 - 0.05, b2[0] + 6.3, b2[1] + H / 2 + 0.05,
           "include", label_dx=-10.4, label_dy=-0.35)

# ---- note -------------------------------------------------------------------
ax.text(74.0, 36.0,
        "Internal system processes (Sentinel API,\nanalysis worker, detection engine) live\n"
        "inside the boundary and are not drawn\nas UML actors.\n\n"
        "«include»: artifact validation and rule\ntesting are mandatory sub-flows of their\nbase use cases.",
        ha="center", va="top", fontsize=7.8, color=GREY, linespacing=1.55,
        bbox=dict(boxstyle="round,pad=0.5", fc="#F5F7FB", ec="#B9C2D0"))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "use_case_diagram")
save(fig, out)
print("saved", out)
