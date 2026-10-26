"""Sentinel — Level 1 Data Flow Diagram.

Six major processes, six logical data stores, three external entities.
Coordinate plan:

  Entities : Artifact Source (10,91) | Analyst (10,62) | Administrator (10,16)
  Row y=91 : 1.0 (33)      2.0 (59)      3.0 (85)
  Row y=70 : D1 (33)       D2 (59)       D3 (85)
  Row y=42 : 6.0 (33)      5.0 (59)      4.0 (85)
  Row y=18 : D6 (33)       D5 (59)       D4 (85)

  Known single deliberate crossing: 6.0 -> D3 crosses the D2 -> 5.0 read
  channel in the store band.
"""

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from common import *
from matplotlib.path import Path
from matplotlib.patches import PathPatch

fig, ax = new_canvas(18.5, 10.6, None)

def elbow(pts, label=None, lp=None, color=NAVY, lw=1.5):
    verts = pts
    codes = [Path.MOVETO] + [Path.LINETO] * (len(pts) - 1)
    ax.add_patch(PathPatch(Path(verts, codes), fill=False, ec=color, lw=lw, zorder=2))
    ax.add_patch(FancyArrowPatch(pts[-2], pts[-1], arrowstyle="-|>", mutation_scale=16,
                                 color=color, lw=lw, shrinkA=0, shrinkB=0, zorder=2))
    if label:
        lx, ly = lp
        ax.text(lx, ly, label, ha="center", va="center", fontsize=7.4, color=color,
                zorder=6, linespacing=1.25,
                bbox=dict(boxstyle="round,pad=0.25", fc="white", ec="none", alpha=0.9))

# ---- entities ---------------------------------------------------------------
external_entity(ax, 10, 91, 15, 8, "Security Artifact Source\n(EVTX export supply)")
external_entity(ax, 10, 62, 15, 10, "Security Analyst\n(React console)")
external_entity(ax, 10, 16, 19, 9, "System Administrator /\nRule Administrator")

# ---- processes (top row) ----------------------------------------------------
process(ax, 33, 91, 18, 10, "1.0", "Manage Artifact\nIngestion")
process(ax, 59, 91, 18, 10, "2.0", "Parse and Normalize\nEvents")
process(ax, 85, 91, 18, 10, "3.0", "Execute Detection\nRules")
process(ax, 33, 42, 18, 10, "6.0", "Manage Rules and\nConfiguration")
process(ax, 59, 42, 18, 10, "5.0", "Investigate and\nReport Results")
process(ax, 85, 42, 18, 10, "4.0", "Store Findings\nand Evidence")

# ---- stores -----------------------------------------------------------------
for cx, sid, lab in [
    (33, "D1", "Artifact Metadata and Analysis Jobs"),
    (59, "D2", "Canonical Events and Artifact Facts"),
    (85, "D3", "Detection Rules and Rule Versions"),
]:
    dataframe_box(ax, cx, 70, 19, 6.4, sid, lab)
for cx, sid, lab in [
    (33, "D6", "Users, Workspaces and Configuration"),
    (59, "D5", "Execution and Error Records"),
    (85, "D4", "Findings and Evidence Snapshots"),
]:
    dataframe_box(ax, cx, 18, 19, 6.4, sid, lab)

# ---- entity flows -----------------------------------------------------------
elbow([(17.6, 93), (24, 93)], lp=(20.5, 96.2), label="security artifact\n(EVTX file)")
elbow([(24, 89), (17.7, 89)], lp=(20.5, 86.4), label="upload ack +\nprocessing status")
elbow([(13, 67), (24, 86.3)], lp=(14.0, 77.5), label="upload request")
elbow([(27, 86), (17.6, 63.6)], lp=(21.6, 69.4), label="artifact status")
elbow([(17.6, 19), (24, 24.0)], lp=(16.0, 24.0), label="rule +\nconfig requests")
elbow([(22, 26.2), (24, 39.5)], lp=(16.2, 34.5), label="rule-validation\nresults")

# ---- top band ---------------------------------------------------------------
elbow([(33, 86), (33, 73.3)], lp=(38.6, 80.0), label="artifact metadata\n+ ingest job")
elbow([(42, 71.3), (50, 86.3)], lp=(47.2, 76.2), label="job claim +\nraw-object ref")
elbow([(50, 84.6), (42, 69.4)], lp=(46.9, 72.2), label="triage status +\nrun record")
elbow([(59, 86), (59, 73.3)], lp=(64.0, 80.4), label="canonical\nevents (v1)")
elbow([(68, 71.3), (76, 86.3)], lp=(72.4, 75.8), label="canonical\nbatch")
elbow([(85, 73.3), (85, 86)], lp=(91.6, 80.2), label="enabled rules\n+ rule versions")

# ---- middle band ------------------------------------------------------------
elbow([(37, 47), (76.2, 68.6)], lp=(51.0, 62.4), label="validated rule documents\n+ versions")
elbow([(62, 66.7), (62, 47.2)], lp=(68.6, 57.6), label="query canonical\nevents")

# analyst <-> 5.0 corridor
elbow([(14, 57), (14, 52), (46, 52)], lp=(27.0, 54.4), label="investigation queries")
elbow([(46, 52), (46, 44.2), (49.7, 44.2)])
elbow([(49.7, 39.5), (47.5, 39.5), (47.5, 54.0), (23, 54.0), (23, 62), (17.6, 62)],
      lp=(34.5, 56.6), label="findings, evidence,\nstatus, errors")
elbow([(42, 67.6), (30.5, 67.6), (30.5, 50.0), (36, 50.0), (36, 45.6), (49.7, 45.6)],
      lp=(42.8, 51.0), label="artifact / job status")

# detection chain
elbow([(94, 89.5), (96.7, 89.5), (96.7, 42.6), (94.4, 42.6)],
      lp=(91.5, 56.3), label="candidate findings\n+ evidence data")
elbow([(85, 37), (85, 21.3)], lp=(94.4, 27.6), label="findings + evidence\n(upsert)")
elbow([(94, 87.6), (98.4, 87.6), (98.4, 12.5), (70.9, 12.5), (70.9, 16.3), (68.5, 16.3)],
      lp=(89.4, 10.4), label="rule-run outcomes, reason codes, errors")

# ---- bottom band ------------------------------------------------------------
elbow([(33, 37), (33, 21.3)], lp=(38.6, 27.6), label="user / workspace /\nconfig updates")
elbow([(59, 37), (59, 21.3)], lp=(64.2, 27.6), label="read errors +\nexecution records")
elbow([(66, 36.8), (68, 33.5), (76, 22)], lp=(75.6, 31.0), label="read findings\n+ evidence")

# ---- legend -----------------------------------------------------------------
legend(ax, 8.0, 6.5,
       "rounded rectangle + number band = process      open-ended rectangle = data store      square = external entity\n"
       "arrow = direction of data flow.  Process numbering continues into Level 2 (process 3.0).")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dfd_level_1")
save(fig, out)
print("saved", out)
