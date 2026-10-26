"""Sentinel — Level 0 (Context) Data Flow Diagram.

One process (0 Sentinel Security Analysis Platform), three external entities,
clearly labelled directional data flows. No data stores, no internal process
decomposition at this level.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *
from matplotlib.path import Path
from matplotlib.patches import PathPatch

fig, ax = new_canvas(17.0, 9.2, None)

# ---- central process --------------------------------------------------------
PCX, PCY, PW, PH = 51.0, 48.0, 27.0, 21.0
process(ax, PCX, PCY, PW, PH, "0", "Sentinel Security\nAnalysis Platform",
        fill="#E7EEFC")
ax.text(PCX, PCY - 4.6, "(accepts artifacts, evaluates detection\nrules, produces findings with evidence)",
        ha="center", va="top", fontsize=7.4, color=GREY, zorder=5, linespacing=1.4)

EL, ER, PW2, PH2 = 13.0, 8.6, 16.0, 9.0

# ---- external entities ------------------------------------------------------
external_entity(ax, EL, 76.0, 18.0, 9.5, "Security Analyst\n(React console)")
external_entity(ax, EL, 22.0, 19.5, 9.5, "System Administrator /\nRule Administrator")
external_entity(ax, 86.5, 48.0, 18.0, 9.5, "Security Artifact Source\n(EVTX export supply)")

def elbow(pts, label=None, lp=None, color=NAVY):
    verts = pts
    codes = [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1)
    ax.add_patch(PathPatch(Path(verts, codes), fill=False, ec=color, lw=1.5, zorder=2))
    ax.add_patch(FancyArrowPatch(pts[-2], pts[-1], arrowstyle="-|>", mutation_scale=16,
                                 color=color, lw=1.5, shrinkA=0, shrinkB=0, zorder=2))
    if label:
        lx, ly = lp
        ax.text(lx, ly, label, ha="center", va="center", fontsize=7.5, color=color,
                zorder=6, linespacing=1.25,
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.92))

lx, ly = EL, 76.0
R = lx + 9.0
# analyst flows
elbow([(R, 78.0), (PCX - PW / 2, 53.5)], lp=((R + PCX - PW / 2) / 2 + 3.5, 70.0),
      label="artifact upload\nrequest (EVTX)")
elbow([(R, 74.5), (PCX - PW / 2, 50.0)], lp=((R + PCX - PW / 2) / 2 + 3.5, 62.5),
      label="analysis request\n+ investigation queries")
elbow([(PCX - PW / 2, 46.0), (R, 71.5)], lp=((R + PCX - PW / 2) / 2 + 1.5, 56.5),
      label="analysis status +\nerrors / reason codes")
elbow([(PCX - PW / 2, 42.5), (R, 68.0)], lp=((R + PCX - PW / 2) / 2 - 2.0, 51.5),
      label="findings + evidence\nsnapshots + timeline")

axx = EL - 10.0
# admin flows (2 in / 2 out, parallel, non-crossing)
elbow([(axx + 10.5, 25.0), (PCX - PW / 2, 42.0)], lp=((axx + 10.5 + PCX) / 2, 37.5),
      label="rule-management\nrequests")
elbow([(axx + 10.5, 19.0), (PCX - PW / 2, 36.5)], lp=((axx + 10.5 + PCX) / 2 - 1.5, 30.5),
      label="user / workspace and\nconfiguration requests")
elbow([(PCX - PW / 2, 31.0), (axx + 10.5, 22.0)], lp=((axx + 10.5 + PCX) / 2, 26.0),
      label="rule-validation results\n+ audit / execution records")

# artifact source flows
sx = 86.5
elbow([(sx - 9.0, 50.5), (PCX + PW / 2, 51.0)], lp=((sx - 9.0 + PCX + PW / 2) / 2, 55.5),
      label="security artifact\n(EVTX export)")
elbow([(PCX + PW / 2, 45.0), (sx - 9.0, 45.5)], lp=((sx - 9.0 + PCX + PW / 2) / 2, 41.0),
      label="upload / processing\nacknowledgement")

# ---- legend -----------------------------------------------------------------
legend(ax, 30.5, 8.6,
       "rounded rectangle = process (number band)      square = external entity      arrow = direction of data flow\n"
       "Level 0 shows the whole platform as one process; data stores and sub-processes are internal and not drawn here.")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dfd_level_0")
save(fig, out)
print("saved", out)
