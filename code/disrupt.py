"""Disruption scenario generator.

A scenario is a batch of k unpredictable events (UE) reported at a common decision epoch t0
(e.g. heavy rain or a road incident at the start of the morning peak). Each event hits one
driver and starts at t in [t0, t0+WINDOW].

Event types (lengths in minutes), following the CRSMAS thesis plus the 'absence' event the
thesis lists as future work:
  LATE   lateness          15-60
  DELAY  delay             80-180
  UNV    unavailability    30-120 (driver cannot continue part of the duty)
  ABS    absence           rest of the duty
"""
import numpy as np
from model import duty_times

WINDOW, READY = 60, 5
TYPES = [('LATE', 0.30, (15, 60)), ('DELAY', 0.20, (80, 180)),
         ('UNV', 0.30, (30, 120)), ('ABS', 0.20, None)]


def make_scenario(inst, duties, k, seed):
    rng = np.random.default_rng(seed)
    st = min(l['start'] for l in inst['legs']); en = max(l['end'] for l in inst['legs'])
    t0 = int(st + rng.uniform(0.20, 0.60) * (en - st))
    events = []; used = set()
    names = [t[0] for t in TYPES]; p = np.array([t[1] for t in TYPES])
    for _ in range(k * 20):
        if len(events) == k:
            break
        t = int(t0 + rng.integers(0, WINDOW + 1))
        # drivers with work starting in [t, t+60] and not yet hit
        cand = [i for i, d in enumerate(duties) if i not in used and any(t <= l['start'] <= t + 60 for l in d)]
        if not cand:
            continue
        di = int(rng.choice(cand))
        ty = names[rng.choice(len(names), p=p)]
        rngl = dict((a, c) for a, _, c in TYPES)[ty]
        dur = 10_000 if rngl is None else int(rng.integers(rngl[0], rngl[1] + 1))
        uncovered = [l for l in duties[di] if l['start'] < t + dur + READY and l['end'] > t]
        if not uncovered:
            continue
        used.add(di)
        events.append(dict(driver=di, type=ty, t=t, dur=dur, legs=[l['id'] for l in uncovered]))
    return dict(t0=t0, events=events, k=k, seed=seed)


def apply(inst, duties, sc):
    """Return (remaining duties after removing uncovered legs, list of uncovered legs,
    set of disrupted driver indices)."""
    by_id = {l['id']: l for l in inst['legs']}
    unc_ids = {i for e in sc['events'] for i in e['legs']}
    rem = [[l for l in d if l['id'] not in unc_ids] for d in duties]
    unc = sorted((by_id[i] for i in unc_ids), key=lambda x: x['start'])
    dis = {e['driver'] for e in sc['events']}
    return rem, unc, dis
