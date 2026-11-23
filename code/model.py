"""Driver duty model, labour rules and baseline (pre-disruption) duty construction.

Rules (simplified from EC Regulation 561/2006 and the CRSMAS thesis):
  MAX_SPAN     sign-on to sign-off <= 600 min
  MAX_DRIVE    total driving        <= 540 min (9 h)
  MAX_CONT     continuous driving   <= 270 min (4.5 h) unless a break >= BREAK_MIN occurs
  BREAK_MIN    break length         >= 30 min
  Changeover   end_i + dist[ep_i, sp_j] <= start_j (0 if driver stays on the same bus)
  Sign-on/off  at depot, plus travel depot <-> first/last leg position
"""
import numpy as np

MAX_SPAN, MAX_DRIVE, MAX_CONT, BREAK_MIN = 600, 540, 270, 30


def link_time(inst, a, b):
    """Minimum gap needed between leg a and following leg b for the same driver."""
    if a['tour'] == b['tour'] and a['ep'] == b['sp']:
        return 0
    return inst['dist'][a['ep'], b['sp']]


def duty_times(inst, legs):
    """Return (sign_on_time, sign_off_time) for an ordered leg list."""
    d = inst['dist']; dep = inst['depot']
    f, l = legs[0], legs[-1]
    on = f['start'] - d[dep, f['sp']] - inst['sign_on']
    off = l['end'] + d[l['ep'], dep] + inst['sign_off']
    return on, off


def feasible(inst, legs, earliest_on=None):
    """Check a full duty (legs ordered by start). Returns True/False."""
    if not legs:
        return True
    drive = 0; cont = 0
    for i, lg in enumerate(legs):
        if i:
            p = legs[i - 1]
            gap = lg['start'] - p['end']
            if gap < link_time(inst, p, lg):
                return False
            if gap >= BREAK_MIN:
                cont = 0
        dur = lg['end'] - lg['start']
        drive += dur; cont += dur
        if cont > MAX_CONT or drive > MAX_DRIVE:
            return False
    on, off = duty_times(inst, legs)
    if off - on > MAX_SPAN:
        return False
    if earliest_on is not None and on < earliest_on:
        return False
    return True


def insert_sorted(legs, new):
    out = sorted(list(legs) + list(new), key=lambda x: x['start'])
    return out


def build_baseline(inst):
    """Greedy constructive duty schedule: drivers follow their bus where possible,
    otherwise take the feasible leg that minimises idle time; open a new duty if needed.
    Returns list of duties (each a list of leg dicts)."""
    legs = sorted(inst['legs'], key=lambda x: (x['start'], x['tour']))
    duties = []           # list of leg lists
    last = []             # last leg per duty
    for lg in legs:
        best = None
        for k, dl in enumerate(duties):
            p = last[k]
            if p['end'] > lg['start']:
                continue
            if lg['start'] - p['end'] < link_time(inst, p, lg):
                continue
            # quick bound checks before full check
            on, _ = duty_times(inst, dl)
            if lg['end'] + inst['dist'][lg['ep'], inst['depot']] + inst['sign_off'] - on > MAX_SPAN:
                continue
            if not feasible(inst, dl + [lg]):
                continue
            idle = lg['start'] - p['end']
            same = (p['tour'] == lg['tour'])
            key = (0 if same else 1, idle)
            if best is None or key < best[0]:
                best = (key, k)
        if best is None:
            duties.append([lg]); last.append(lg)
        else:
            duties[best[1]].append(lg); last[best[1]] = lg
    return duties


def check_all(inst, duties):
    covered = sorted(l['id'] for d in duties for l in d)
    return all(feasible(inst, d) for d in duties) and len(covered) == len(set(covered))


def consolidate(inst, duties, passes=3):
    """Improve the baseline: try to dissolve the smallest duties by inserting their legs
    into other duties (full rule check). Produces tighter, more realistic schedules."""
    duties = [list(d) for d in duties]
    for _ in range(passes):
        changed = False
        order = sorted(range(len(duties)), key=lambda i: sum(l['end'] - l['start'] for l in duties[i]))
        for i in order:
            if not duties[i]:
                continue
            trial = {}
            ok = True
            for lg in sorted(duties[i], key=lambda x: x['start']):
                placed = False
                cands = sorted((j for j in range(len(duties)) if j != i and duties[j]),
                               key=lambda j: -sum(l['end'] - l['start'] for l in duties[j]))
                for j in cands:
                    cur = trial.get(j, duties[j])
                    new = sorted(cur + [lg], key=lambda x: x['start'])
                    if feasible(inst, new):
                        trial[j] = new; placed = True; break
                if not placed:
                    ok = False; break
            if ok:
                for j, v in trial.items():
                    duties[j] = v
                duties[i] = []
                changed = True
        duties = [d for d in duties if d]
        if not changed:
            break
    return duties
