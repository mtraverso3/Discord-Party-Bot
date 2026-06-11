#!/usr/bin/env python3
"""
match_timeline.py
Fetch the Riot Match v5 timeline and show per-player stat diffs on
item purchases, augment selections, and skill level-ups.

The key payload is participantFrames[].championStats — Riot snapshots
actual champion stats (AD, AP, HP, armor, MR, AS, AH…) every 60s.
Because snapshots are a minute apart, every event inside the same
window shares one before/after frame pair, so the stat delta is shown
ONCE per window (a "Δ" line) rather than repeated on every event.

Setup:
  export RIOT_API_KEY="RGAPI-..."

Usage:
  python match_timeline.py <matchId|replay.rofl>
  python match_timeline.py NA1_1234567890 --player Doublelift
  python match_timeline.py NA1_1234567890 --region europe
  python match_timeline.py NA1_1234567890 --json
  python match_timeline.py NA1_1234567890 --event-types        # list event types seen
  python match_timeline.py NA1_1234567890 --items item.json    # resolve item names
  python match_timeline.py NA1_1234567890 --augments arena.json

Item names JSON:   https://ddragon.leagueoflegends.com/cdn/<ver>/data/en_US/item.json
Augment names JSON: https://raw.communitydragon.org/latest/cdragon/arena/en_us.json
"""

import json
import os
import re
import sys
import urllib.request
import urllib.error
from bisect import bisect_right
from itertools import groupby
from pathlib import Path
from typing import Optional


# ─── Config ────────────────────────────────────────────────────────────────

DEFAULT_REGION = "americas"

# Events pulled out of the timeline.  Riot uses these type strings.
PURCHASE_EVENTS = {"ITEM_PURCHASED", "ITEM_SOLD", "ITEM_UNDO"}
BUILD_EVENTS    = PURCHASE_EVENTS | {"AUGMENT_BUY", "SKILL_LEVEL_UP", "LEVEL_UP"}

# championStats fields and how to display them.
# Percent-type stats (attackSpeed, lifesteal, omnivamp, crit) arrive as
# integer percent points already (39 == +39% AS), so no rescaling.
# (key, short label, display as percent, threshold to bother showing)
STAT_DISPLAY = [
    ("attackDamage",       "AD",    False, 1),
    ("abilityPower",       "AP",    False, 1),
    ("healthMax",          "HP",    False, 10),
    ("armor",              "AR",    False, 1),
    ("magicResist",        "MR",    False, 1),
    ("attackSpeed",        "AS",    True,  1),
    ("abilityHaste",       "AH",    False, 1),
    ("movementSpeed",      "MS",    False, 5),   # noisy: in-combat buffs/slows land in snapshots
    ("armorPen",           "ArPen", False, 1),
    ("magicPen",           "MgPen", False, 1),
    ("lifesteal",          "LS",    True,  1),
    ("omnivamp",           "OV",    True,  1),
    ("critChance",         "Crit",  True,  1),   # present in some versions
]

# Arena variants of shop items are the base item ID prefixed with "22"
# (223006 == Berserker's Greaves 3006), so a plain item.json can still
# resolve them.
ARENA_ITEM_PREFIX = 220000


# ─── Riot API ───────────────────────────────────────────────────────────────

def _get(url: str, api_key: str) -> dict:
    req = urllib.request.Request(url, headers={
        "X-Riot-Token":   api_key,
        "User-Agent":     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept":         "application/json",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise SystemExit(f"HTTP {e.code} from Riot API: {body}") from e


def fetch_match(match_id: str, region: str, api_key: str) -> dict:
    return _get(
        f"https://{region}.api.riotgames.com/lol/match/v5/matches/{match_id}",
        api_key,
    )


def fetch_timeline(match_id: str, region: str, api_key: str) -> dict:
    return _get(
        f"https://{region}.api.riotgames.com/lol/match/v5/matches/{match_id}/timeline",
        api_key,
    )


# ─── Match ID helpers ───────────────────────────────────────────────────────

def match_id_from_path(s: str) -> str:
    """Accept 'NA1_123', 'NA1-123', or a /path/to/NA1-123.rofl."""
    stem = Path(s).stem if s.endswith(".rofl") else s
    norm = re.sub(r"[-_]", "_", stem, count=1)   # normalise first separator
    if not re.match(r"^[A-Z0-9]+_\d+$", norm):
        raise SystemExit(f"Couldn't parse a match ID from {s!r}")
    return norm


# ─── Frame index ────────────────────────────────────────────────────────────

class FrameIndex:
    """Fast lookup of the nearest frame before/after a timestamp."""

    def __init__(self, frames: list[dict]):
        self.timestamps = [f["timestamp"] for f in frames]
        self.frames     = frames

    def before(self, ts: int) -> Optional[dict]:
        i = bisect_right(self.timestamps, ts) - 1
        return self.frames[i] if i >= 0 else None

    def after(self, ts: int) -> Optional[dict]:
        i = bisect_right(self.timestamps, ts)
        return self.frames[i] if i < len(self.frames) else None

    def participant_stats(self, frame: Optional[dict], pid: int) -> Optional[dict]:
        if frame is None:
            return None
        pf = frame.get("participantFrames", {}).get(str(pid))
        return pf.get("championStats") if pf else None


# ─── Core parsing ───────────────────────────────────────────────────────────

def parse(match_data: dict, timeline_data: dict) -> list[dict]:
    """
    Returns a list of player dicts:
      {name, champion, teamId, participantId, events: [...]}

    Each event:
      {ts, type, itemId?, augmentId?, skillSlot?, level?,
       window: (beforeFrameTs, afterFrameTs),
       before: championStats, after: championStats}
    """
    # Build participant map
    participants = {
        p["participantId"]: {
            "name":      p.get("riotIdGameName") or p.get("summonerName", f"P{p['participantId']}"),
            "champion":  p["championName"],
            "teamId":    p["teamId"],
        }
        for p in match_data["info"]["participants"]
    }

    raw_frames = timeline_data["info"]["frames"]
    idx = FrameIndex(raw_frames)

    # Collect events per participant
    events_by_pid: dict[int, list] = {pid: [] for pid in participants}

    for frame in raw_frames:
        for ev in frame.get("events", []):
            etype = ev.get("type", "")
            if etype not in BUILD_EVENTS:
                continue
            pid = ev.get("participantId")
            if pid not in events_by_pid:
                continue

            ts = ev["timestamp"]
            before_frame = idx.before(ts)
            after_frame  = idx.after(ts)

            record: dict = {
                "ts":    ts,
                "type":  etype,
                "window": (
                    before_frame["timestamp"] if before_frame else None,
                    after_frame["timestamp"]  if after_frame  else None,
                ),
                "before": idx.participant_stats(before_frame, pid),
                "after":  idx.participant_stats(after_frame,  pid),
            }
            if etype in PURCHASE_EVENTS:
                record["itemId"] = ev.get("itemId") or ev.get("beforeId")
            if etype == "AUGMENT_BUY":
                # Riot has used both itemId and augmentId across patches
                record["augmentId"] = ev.get("augmentId") or ev.get("itemId")
            if etype == "SKILL_LEVEL_UP":
                record["skillSlot"] = ev.get("skillSlot")
            if etype == "LEVEL_UP":
                record["level"] = ev.get("level")

            events_by_pid[pid].append(record)

    return [
        {
            **participants[pid],
            "participantId": pid,
            "events": sorted(events_by_pid[pid], key=lambda e: e["ts"]),
        }
        for pid in sorted(participants)
    ]


# ─── Stat diff ──────────────────────────────────────────────────────────────

def stat_diff(before: Optional[dict], after: Optional[dict]) -> list[tuple]:
    """Return (label, delta, as_pct) tuples for stats that changed meaningfully."""
    if not before or not after:
        return []
    diffs = []
    for key, label, as_pct, threshold in STAT_DISPLAY:
        b = before.get(key, 0) or 0
        a = after.get(key, 0) or 0
        delta = a - b
        if abs(delta) < threshold:
            continue
        diffs.append((label, delta, as_pct))
    return diffs


def fmt_diff(diffs: list) -> str:
    parts = []
    for label, delta, as_pct in diffs:
        suffix = "%" if as_pct else ""
        parts.append(f"{label} {delta:+.0f}{suffix}")
    return "  ".join(parts)


# ─── Display ────────────────────────────────────────────────────────────────

SKILL_SLOT = {1: "Q", 2: "W", 3: "E", 4: "R"}


def ms_to_clock(ms: int) -> str:
    s = ms // 1000
    return f"{s // 60}:{s % 60:02d}"


def resolve_item(iid: int, item_names: dict[int, str]) -> str:
    if iid in item_names:
        return item_names[iid]
    base = iid - ARENA_ITEM_PREFIX
    if 0 < base < 10000 and base in item_names:
        return item_names[base]
    return f"item {iid}"


def event_label(ev: dict, item_names: dict[int, str], augment_names: dict[int, str]) -> str:
    match ev["type"]:
        case "ITEM_PURCHASED":
            return f"BUY    {resolve_item(ev.get('itemId', 0), item_names)}"
        case "ITEM_SOLD":
            return f"SELL   {resolve_item(ev.get('itemId', 0), item_names)}"
        case "ITEM_UNDO":
            return f"UNDO   {resolve_item(ev.get('itemId', 0), item_names)}"
        case "AUGMENT_BUY":
            aid = ev.get("augmentId", 0)
            return f"AUG    {augment_names.get(aid, f'augment {aid}')}"
        case "SKILL_LEVEL_UP":
            return f"SKILL  {SKILL_SLOT.get(ev.get('skillSlot', 0), '?')}"
    return ev["type"]


def render(
    players: list[dict],
    item_names: dict[int, str],
    augment_names: dict[int, str],
    player_filter: Optional[str] = None,
):
    for p in players:
        if player_filter and player_filter.lower() not in p["name"].lower():
            continue

        print(f"\n{'━'*62}")
        print(f"  {p['champion']} ({p['name']})  team {p['teamId']}")
        print(f"{'━'*62}")

        # Events in the same frame window share one before/after snapshot
        # pair, so group them and print the stat delta once per window.
        for window, group in groupby(p["events"], key=lambda e: e["window"]):
            group = list(group)
            i = 0
            while i < len(group):
                ev = group[i]
                t  = ms_to_clock(ev["ts"])

                if ev["type"] == "LEVEL_UP":
                    # Collapse a run of LEVEL_UPs (Arena grants 2 at a time)
                    levels = [ev.get("level", "?")]
                    while i + 1 < len(group) and group[i + 1]["type"] == "LEVEL_UP":
                        i += 1
                        levels.append(group[i].get("level", "?"))
                    print(f"  {t:>5}  LEVEL  → {', '.join(str(l) for l in levels)}")
                else:
                    print(f"  {t:>5}  {event_label(ev, item_names, augment_names)}")
                i += 1

            diffs = stat_diff(group[0]["before"], group[0]["after"])
            if diffs:
                b_ts, a_ts = window
                span = (
                    f"{ms_to_clock(b_ts)}→{ms_to_clock(a_ts)}"
                    if b_ts is not None and a_ts is not None else "?"
                )
                print(f"         Δ {span}  {fmt_diff(diffs)}")
        print()


# ─── Name resolution ────────────────────────────────────────────────────────

def load_item_names(path: str) -> dict[int, str]:
    raw = json.loads(Path(path).read_text())
    return {int(k): v["name"] for k, v in raw["data"].items()}


def load_augment_names(path: str) -> dict[int, str]:
    raw = json.loads(Path(path).read_text())
    return {a["id"]: a["name"] for a in raw.get("augments", [])}


# ─── CLI ─────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str]) -> dict:
    args = iter(argv)
    opts = {
        "target":       None,
        "region":       DEFAULT_REGION,
        "player":       None,
        "items_json":   None,
        "augments_json": None,
        "as_json":      False,
        "event_types":  False,
    }
    for a in args:
        if   a == "--region":    opts["region"]       = next(args)
        elif a == "--player":    opts["player"]        = next(args)
        elif a == "--items":     opts["items_json"]    = next(args)
        elif a == "--augments":  opts["augments_json"] = next(args)
        elif a == "--json":      opts["as_json"]       = True
        elif a == "--event-types": opts["event_types"] = True
        elif not a.startswith("-"): opts["target"]    = a
    return opts


def main():
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)

    opts     = parse_args(sys.argv[1:])
    api_key  = os.environ.get("RIOT_API_KEY", "")
    if not api_key:
        raise SystemExit("Set RIOT_API_KEY environment variable")

    match_id = match_id_from_path(opts["target"])
    region   = opts["region"]

    print(f"Fetching {match_id} ({region})…")
    match_data    = fetch_match(match_id, region, api_key)
    timeline_data = fetch_timeline(match_id, region, api_key)

    # --event-types: print every unique event type in the timeline and exit.
    # Useful for figuring out what Arena uses for augments on a given patch.
    if opts["event_types"]:
        types: set[str] = set()
        for frame in timeline_data["info"]["frames"]:
            for ev in frame.get("events", []):
                types.add(ev.get("type", "UNKNOWN"))
        print("\nEvent types found:")
        for t in sorted(types):
            print(f"  {t}")
        return

    players = parse(match_data, timeline_data)

    item_names    = load_item_names(opts["items_json"])    if opts["items_json"]    else {}
    augment_names = load_augment_names(opts["augments_json"]) if opts["augments_json"] else {}

    if opts["as_json"]:
        print(json.dumps(players, indent=2, default=str))
        return

    render(players, item_names, augment_names, player_filter=opts["player"])


if __name__ == "__main__":
    main()
