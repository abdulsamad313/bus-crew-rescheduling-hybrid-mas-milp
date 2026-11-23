"""Rescheduling methods compared in the paper.

  CRSMAS     Original CRSMAS (thesis, 2008): each event handled in its own window on a
             snapshot of the schedule, single round, nearest-match rule. Windows do not see
             each other's decisions, so double bookings (conflicts) can occur and are
             resolved afterwards by dropping later assignments.
  CRSMAS-MR  CRSMAS with the thesis' proposed modifications: shared crew 'Status' flag
             (sequential processing) and multiple matching rounds that split unmatched
             pieces into smaller parts (up to MAX_ROUNDS).
  MILP       Centralised leg-level MILP (HiGHS via scipy) with pairwise compatibility
             constraints and a driving-time capacity; break/span interactions involving
             three or more legs are not captured, so solutions are repaired afterwards.
  HYB        Proposed hybrid MAS + MILP: every available driver agent generates bids
             (bundles of uncovered legs it can feasibly take, checked against the full rule
             set locally); a coordinator solves a winner-determination set-packing MILP.
"""
import time
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix
from model import feasible, duty_times, link_time, MAX_DRIVE
from disrupt import READY

W_LEG, W_RES, W_REG = 1000.0, 10.0, 1.0
MAX_ROUNDS = 4
MILP_TL = 60.0


# --------------------------------------------------------------------------- context
class Ctx:
    def __init__(self, inst, duties, rem, unc, dis, t0, n_res):
        self.inst = inst; self.t0 = t0; self.unc = unc
        self.agents = []   # dict(kind, legs, on)
        for i, d in enumerate(rem):
            if i in dis or not duties[i]:
                continue
            on0 = duty_times(inst, duties[i])[0]
            self.agents.append(dict(kind='REG', idx=i, legs=list(d), on=min(on0, t0)))
        for r in range(n_res):
            self.agents.append(dict(kind='RES', idx=-1 - r, legs=[], on=t0))
        # pieces: runs of uncovered legs of the same disrupted driver linked with zero link time
        by_drv = {}
        self.unc_ids = {l['id'] for l in unc}
        for i in dis:
            run = []
            for l in duties[i]:
                if l['id'] in self.unc_ids:
                    if run and link_time(inst, run[-1], l) == 0 and l['start'] - run[-1]['end'] < 30:
                        run.append(l)
                    else:
                        if run:
                            by_drv.setdefault(i, []).append(run)
                        run = [l]
                else:
                    if run:
                        by_drv.setdefault(i, []).append(run); run = []
            if run:
                by_drv.setdefault(i, []).append(run)
        self.pieces = sorted([p for v in by_drv.values() for p in v], key=lambda p: p[0]['start'])
        self.event_of = {}
        self.coverable = [l for l in unc if l['start'] >= t0 + READY]

    def can_take(self, a, S):
        if any(l['start'] < self.t0 + READY for l in S):
            return False
        return feasible(self.inst, sorted(a['legs'] + list(S), key=lambda x: x['start']), earliest_on=a['on'])

    def slack(self, a, P):
        prev = [l for l in a['legs'] if l['end'] <= P[0]['start']]
        if prev:
            p = prev[-1]
            return P[0]['start'] - (p['end'] + link_time(self.inst, p, P[0]))
        d = self.inst['dist']
        return P[0]['start'] - (max(a['on'], self.t0) + self.inst['sign_on'] + d[self.inst['depot'], P[0]['sp']])


def evaluate(ctx, assign, extra=None):
    """assign: dict agent_index -> list of legs added. Verifies feasibility and coverage."""
    covered = set(); res_used = 0; reg_changed = 0; viol = 0; dup = 0
    for ai, S in assign.items():
        if not S:
            continue
        a = ctx.agents[ai]
        if not ctx.can_take(a, S):
            viol += 1
        if a['kind'] == 'RES':
            res_used += 1
        else:
            reg_changed += 1
        for l in S:
            if l['id'] in covered:
                dup += 1
            covered.add(l['id'])
    n_unc = len(ctx.unc)
    out = dict(n_unc=n_unc, n_coverable=len(ctx.coverable), covered=len(covered),
               coverage=len(covered) / n_unc if n_unc else 1.0,
               coverage_coverable=len(covered) / len(ctx.coverable) if ctx.coverable else 1.0,
               reserves=res_used, drivers_changed=reg_changed, violations=viol, duplicates=dup)
    if extra:
        out.update(extra)
    return out


# --------------------------------------------------------------------------- CRSMAS
def _nearest_match(ctx, P, state, allowed=None):
    best = None
    for ai, a in enumerate(ctx.agents):
        if allowed is not None and ai not in allowed:
            continue
        S = state.get(ai, [])
        tmp = dict(a, legs=a['legs'] + S)
        if not ctx.can_take(tmp, P):
            continue
        s = ctx.slack(tmp, P)
        key = (0 if a['kind'] == 'REG' else 1, s)
        if best is None or key < best[0]:
            best = (key, ai)
    return None if best is None else best[1]


def crsmas(ctx, events):
    t = time.perf_counter()
    piece_event = {}
    for ei, e in enumerate(events):
        ids = set(e['legs'])
        for pi, P in enumerate(ctx.pieces):
            if P[0]['id'] in ids:
                piece_event[pi] = ei
    windows = []
    for ei in range(len(events)):
        state = {}   # each window starts from the same snapshot
        for pi, P in enumerate(ctx.pieces):
            if piece_event.get(pi) != ei:
                continue
            ai = _nearest_match(ctx, P, state)
            if ai is not None:
                state.setdefault(ai, []).extend(P)
        windows.append(state)
    # merge windows: conflicts arise when the same driver is booked by several windows
    final = {}; conflicts = 0
    for state in windows:
        for ai, S in state.items():
            cur = final.get(ai, [])
            if cur and not ctx.can_take(ctx.agents[ai], cur + S):
                conflicts += 1
                continue
            final[ai] = cur + S
    return evaluate(ctx, final, dict(conflicts=conflicts, cpu=time.perf_counter() - t))


def _mr_state(ctx):
    state = {}
    queue = [P for P in ctx.pieces]
    for rnd in range(MAX_ROUNDS):
        nxt = []
        for P in sorted(queue, key=lambda p: p[0]['start']):
            ai = _nearest_match(ctx, P, state)
            if ai is not None:
                state.setdefault(ai, []).extend(P)
            elif len(P) > 1:
                h = len(P) // 2
                nxt += [P[:h], P[h:]]
        queue = nxt
        if not queue:
            break
    return state


def crsmas_mr(ctx, events):
    t = time.perf_counter()
    state = _mr_state(ctx)
    return evaluate(ctx, state, dict(conflicts=0, cpu=time.perf_counter() - t))


# --------------------------------------------------------------------------- central MILP
def milp_central(ctx, events):
    t = time.perf_counter()
    L = ctx.coverable
    var = []                      # (agent, leg)
    for ai, a in enumerate(ctx.agents):
        for l in L:
            if ctx.can_take(a, [l]):
                var.append((ai, l))
    if not var:
        return evaluate(ctx, {}, dict(conflicts=0, cpu=time.perf_counter() - t, repaired=0))
    agents_used = sorted({ai for ai, _ in var})
    yidx = {ai: len(var) + k for k, ai in enumerate(agents_used)}
    nv = len(var) + len(agents_used)
    c = np.zeros(nv)
    for j, (ai, l) in enumerate(var):
        c[j] = -W_LEG
    for ai, k in yidx.items():
        c[k] = W_RES if ctx.agents[ai]['kind'] == 'RES' else W_REG
    rows, cols, vals, lb, ub = [], [], [], [], []
    r = 0
    # each leg at most once
    by_leg = {}
    for j, (ai, l) in enumerate(var):
        by_leg.setdefault(l['id'], []).append(j)
    for js in by_leg.values():
        for j in js:
            rows.append(r); cols.append(j); vals.append(1)
        lb.append(-np.inf); ub.append(1); r += 1
    by_ag = {}
    for j, (ai, l) in enumerate(var):
        by_ag.setdefault(ai, []).append(j)
    for ai, js in by_ag.items():
        a = ctx.agents[ai]
        drive_now = sum(l['end'] - l['start'] for l in a['legs'])
        # x <= y
        for j in js:
            rows += [r, r]; cols += [j, yidx[ai]]; vals += [1, -1]; lb.append(-np.inf); ub.append(0); r += 1
        # driving capacity
        for j in js:
            rows.append(r); cols.append(j); vals.append(var[j][1]['end'] - var[j][1]['start'])
        lb.append(-np.inf); ub.append(MAX_DRIVE - drive_now); r += 1
        # pairwise incompatibility
        for p in range(len(js)):
            for q in range(p + 1, len(js)):
                l1, l2 = var[js[p]][1], var[js[q]][1]
                if not ctx.can_take(a, [l1, l2]):
                    rows += [r, r]; cols += [js[p], js[q]]; vals += [1, 1]; lb.append(-np.inf); ub.append(1); r += 1
    A = coo_matrix((vals, (rows, cols)), shape=(r, nv)).tocsr()
    res = milp(c, constraints=LinearConstraint(A, lb, ub), integrality=np.ones(nv),
               bounds=Bounds(0, 1), options=dict(time_limit=MILP_TL, disp=False))
    x = np.round(res.x) if res.x is not None else np.zeros(nv)
    assign = {}
    for j, (ai, l) in enumerate(var):
        if x[j] > 0.5:
            assign.setdefault(ai, []).append(l)
    # repair: drop latest legs until each duty is feasible (triple interactions)
    repaired = 0
    for ai in list(assign):
        S = sorted(assign[ai], key=lambda x: x['start'])
        while S and not ctx.can_take(ctx.agents[ai], S):
            S.pop(); repaired += 1
        assign[ai] = S
    return evaluate(ctx, assign, dict(conflicts=0, cpu=time.perf_counter() - t, repaired=repaired,
                                      milp_status=int(res.status), n_vars=nv, n_cons=r))


# --------------------------------------------------------------------------- hybrid MAS + MILP
MAX_BUNDLE, MAX_BIDS, MAX_NODES = 8, 60, 4000


def agent_bids(ctx, a):
    """Each agent enumerates feasible bundles (DFS with monotone feasibility pruning)."""
    max_nodes = MAX_NODES * (5 if a['kind'] == 'RES' else 1)
    max_bids = MAX_BIDS * (3 if a['kind'] == 'RES' else 1)
    cand = [l for l in ctx.coverable if ctx.can_take(a, [l])]
    cand.sort(key=lambda x: x['start'])
    bids = []; nodes = [0]

    def dfs(start, S):
        if nodes[0] > max_nodes:
            return
        for i in range(start, len(cand)):
            l = cand[i]
            if S and l['start'] < S[-1]['end']:
                continue
            T = S + [l]
            nodes[0] += 1
            if not ctx.can_take(a, T):
                continue          # monotone: no superset of T is feasible
            bids.append(T)
            if len(T) < MAX_BUNDLE:
                dfs(i + 1, T)
    dfs(0, [])
    # keep the most valuable bids: larger bundles first, then same-bus continuity
    def score(T):
        same = sum(1 for i in range(1, len(T)) if T[i]['tour'] == T[i - 1]['tour'])
        return (len(T), same)
    bids.sort(key=score, reverse=True)
    singles = [T for T in bids if len(T) == 1]
    keep = bids[:max_bids]
    ids = {tuple(l['id'] for l in T) for T in keep}
    keep += [T for T in singles if (T[0]['id'],) not in ids]
    return keep


def hybrid(ctx, events):
    t = time.perf_counter()
    # negotiation round (CRSMAS-MR with status flags) gives each agent a seed bid
    seed = _mr_state(ctx)
    bids = [(ai, sorted(S, key=lambda x: x['start'])) for ai, S in seed.items() if S]
    agent_times = []
    for ai, a in enumerate(ctx.agents):
        ta = time.perf_counter()
        for T in agent_bids(ctx, a):
            bids.append((ai, T))
        agent_times.append(time.perf_counter() - ta)
    t_bid = time.perf_counter() - t
    if not bids:
        return evaluate(ctx, {}, dict(conflicts=0, cpu=time.perf_counter() - t, cpu_parallel=0, n_bids=0))
    nb = len(bids)
    c = np.zeros(nb)
    for j, (ai, T) in enumerate(bids):
        cost = W_RES if ctx.agents[ai]['kind'] == 'RES' else W_REG
        c[j] = -(W_LEG * len(T) - cost)
    rows, cols = [], []; r = 0
    leg_rows = {}; ag_rows = {}
    for j, (ai, T) in enumerate(bids):
        for l in T:
            if l['id'] not in leg_rows:
                leg_rows[l['id']] = r; r += 1
            rows.append(leg_rows[l['id']]); cols.append(j)
        if ai not in ag_rows:
            ag_rows[ai] = r; r += 1
        rows.append(ag_rows[ai]); cols.append(j)
    A = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(r, nb)).tocsr()
    tw = time.perf_counter()
    res = milp(c, constraints=LinearConstraint(A, -np.inf, 1), integrality=np.ones(nb),
               bounds=Bounds(0, 1), options=dict(time_limit=MILP_TL, disp=False))
    t_wdp = time.perf_counter() - tw
    x = np.round(res.x) if res.x is not None else np.zeros(nb)
    assign = {}
    for j, (ai, T) in enumerate(bids):
        if x[j] > 0.5:
            assign[ai] = list(T)
    return evaluate(ctx, assign, dict(conflicts=0, cpu=time.perf_counter() - t,
                                      cpu_parallel=max(agent_times) + t_wdp, t_bid=t_bid, t_wdp=t_wdp,
                                      n_bids=nb, milp_status=int(res.status)))


# ------------------------------------------------------- price-guided hybrid (column generation)
from scipy.optimize import linprog

CG_ROUNDS, PRICE_NODES, PRICE_KEEP = 25, 20000, 3


def _wdp_matrix(ctx, bids):
    rows, cols = [], []; r = 0; leg_rows = {}; ag_rows = {}
    for j, (ai, T) in enumerate(bids):
        for l in T:
            if l['id'] not in leg_rows:
                leg_rows[l['id']] = r; r += 1
            rows.append(leg_rows[l['id']]); cols.append(j)
        if ai not in ag_rows:
            ag_rows[ai] = r; r += 1
        rows.append(ag_rows[ai]); cols.append(j)
    A = coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(r, len(bids))).tocsr()
    c = np.array([-(W_LEG * len(T) - (W_RES if ctx.agents[ai]['kind'] == 'RES' else W_REG)) for ai, T in bids])
    return A, c, leg_rows, ag_rows


def _price_agent(ctx, ai, cand, pi, mu):
    """Agent best response: bundles maximising sum(W - pi_l) - cost - mu_a (branch and bound)."""
    a = ctx.agents[ai]
    cost = (W_RES if a['kind'] == 'RES' else W_REG) + mu
    w = [W_LEG - pi.get(l['id'], 0.0) for l in cand]
    suffix = np.concatenate([np.cumsum([max(0, x) for x in w][::-1])[::-1], [0.0]])
    best = []; nodes = [0]

    def dfs(start, S, val):
        if nodes[0] > PRICE_NODES:
            return
        for i in range(start, len(cand)):
            if w[i] <= 1e-9:
                continue
            l = cand[i]
            if S and l['start'] < S[-1]['end']:
                continue
            nv = val + w[i]
            thr = best[-1][0] if len(best) >= PRICE_KEEP else cost + 1e-6
            if nv + suffix[i + 1] <= thr:
                continue
            T = S + [l]; nodes[0] += 1
            if not ctx.can_take(a, T):
                continue
            if nv - cost > 1e-6:
                best.append((nv, T)); best.sort(key=lambda x: -x[0]); del best[PRICE_KEEP:]
            dfs(i + 1, T, nv)
    dfs(0, [], 0.0)
    return [T for _, T in best]


def hybrid_pg(ctx, events, static_bids=True):
    t = time.perf_counter()
    seed = _mr_state(ctx)
    bids = [(ai, sorted(S, key=lambda x: x['start'])) for ai, S in seed.items() if S]
    seen = {(ai, tuple(l['id'] for l in T)) for ai, T in bids}
    cands = {}
    t_par = 0.0
    tmax = 0.0
    for ai, a in enumerate(ctx.agents):
        ta = time.perf_counter()
        cands[ai] = sorted((l for l in ctx.coverable if ctx.can_take(a, [l])), key=lambda x: x['start'])
        for l in cands[ai]:
            key = (ai, (l['id'],))
            if key not in seen:
                seen.add(key); bids.append((ai, [l]))
        tmax = max(tmax, time.perf_counter() - ta)
    t_par += tmax
    if not bids:
        return evaluate(ctx, {}, dict(conflicts=0, cpu=time.perf_counter() - t, cpu_parallel=0, n_bids=0, rounds=0))
    rounds = 0
    for rnd in range(CG_ROUNDS):
        A, c, leg_rows, ag_rows = _wdp_matrix(ctx, bids)
        tl = time.perf_counter()
        lp = linprog(c, A_ub=A, b_ub=np.ones(A.shape[0]), bounds=(0, 1), method='highs')
        t_par += time.perf_counter() - tl
        if lp.status != 0:
            break
        dual = -lp.ineqlin.marginals
        pi = {lid: dual[r] for lid, r in leg_rows.items()}
        new = 0; tmax = 0.0
        for ai in range(len(ctx.agents)):
            if not cands[ai]:
                continue
            ta = time.perf_counter()
            mu = dual[ag_rows[ai]] if ai in ag_rows else 0.0
            for T in _price_agent(ctx, ai, cands[ai], pi, mu):
                key = (ai, tuple(l['id'] for l in T))
                if key not in seen:
                    seen.add(key); bids.append((ai, T)); new += 1
            tmax = max(tmax, time.perf_counter() - ta)
        t_par += tmax
        rounds += 1
        if new == 0:
            break
    A, c, _, _ = _wdp_matrix(ctx, bids)
    tw = time.perf_counter()
    res = milp(c, constraints=LinearConstraint(A, -np.inf, 1), integrality=np.ones(len(bids)),
               bounds=Bounds(0, 1), options=dict(time_limit=MILP_TL, disp=False))
    t_wdp = time.perf_counter() - tw
    t_par += t_wdp
    x = np.round(res.x) if res.x is not None else np.zeros(len(bids))
    assign = {}
    for j, (ai, T) in enumerate(bids):
        if x[j] > 0.5:
            assign[ai] = list(T)
    return evaluate(ctx, assign, dict(conflicts=0, cpu=time.perf_counter() - t, cpu_parallel=t_par,
                                      n_bids=len(bids), rounds=rounds, t_wdp=t_wdp, milp_status=int(res.status)))


METHODS = {'CRSMAS': crsmas, 'CRSMAS-MR': crsmas_mr, 'MILP': milp_central,
           'HYB-S': hybrid, 'HYB-PG': hybrid_pg}
