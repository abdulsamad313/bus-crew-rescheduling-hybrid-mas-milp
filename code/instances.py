"""Instance loaders: BDSP benchmark (Kletzander & Musliu / Mannelli Mazzoli collection)
and Rapid Bus KL GTFS (data.gov.my, CC BY 4.0) converted to the same format.

Common format (dict):
  name, source, legs: list of dicts {id, tour, start, end, sp, ep} (minutes),
  dist: 2-D numpy array of travel minutes between positions (diag = change time),
  depot: position index of the depot (0), sign_on, sign_off (minutes at depot)
"""
import json, glob, os, math
import numpy as np
import pandas as pd

BIG = 99999

def load_bdsp(path):
    d = json.load(open(path))
    n = len(d['distances'])
    dist = np.full((n, n), BIG, dtype=float)
    for i, row in d['distances'].items():
        for j, v in row.items():
            dist[int(i), int(j)] = float(v)
    # shortest-path closure for missing direct links (99999), keep diagonal change time
    diag = dist.diagonal().copy()
    sp = dist.copy(); np.fill_diagonal(sp, 0)
    for k in range(n):
        sp = np.minimum(sp, sp[:, [k]] + sp[[k], :])
    np.fill_diagonal(sp, diag)
    dist = sp
    legs = []
    for k, l in enumerate(sorted(d['legs'], key=lambda x: (x['start'], x['tour']))):
        legs.append(dict(id=k, tour=int(l['tour']), start=int(l['start']), end=int(l['end']),
                         sp=int(l['startPos']), ep=int(l['endPos'])))
    ex = d['extra'].get('0', {'startWork': 15, 'endWork': 10})
    return dict(name=os.path.basename(path)[:-5], source='BDSP', legs=legs, dist=dist,
                depot=0, sign_on=int(ex['startWork']) or 15, sign_off=int(ex['endWork']) or 10)


def _sec(t):
    h, m, s = map(int, t.split(':'))
    return h * 3600 + m * 60 + s


def _hav(a, b):
    R = 6371.0
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def load_rapidkl(gtfs_dir, n_clusters=8, seed=0, speed_kmh=20.0, change=10, layover=5, merge_km=0.4):
    """Expand frequency-based weekday trips, cluster routes geographically into regional
    instances, and chain trips into vehicle blocks (tours) per route."""
    tr = pd.read_csv(f'{gtfs_dir}/trips.txt')
    fr = pd.read_csv(f'{gtfs_dir}/frequencies.txt')
    st = pd.read_csv(f'{gtfs_dir}/stop_times.txt')
    stops = pd.read_csv(f'{gtfs_dir}/stops.txt').set_index('stop_id')
    st['dep'] = st.departure_time.map(_sec); st['arr'] = st.arrival_time.map(_sec)
    g = st.sort_values(['trip_id', 'stop_sequence']).groupby('trip_id')
    tt = pd.DataFrame({'fs': g.stop_id.first(), 'ls': g.stop_id.last(),
                       't0': g.dep.first(), 't1': g.arr.last()})
    tt['dur'] = ((tt.t1 - tt.t0) / 60).round()
    tr = tr[tr.service_id == 'weekday'].merge(tt, left_on='trip_id', right_index=True)
    tr = tr[tr.dur >= 5]
    fr['s'] = fr.start_time.map(_sec); fr['e'] = fr.end_time.map(_sec)
    m = fr.merge(tr, on='trip_id')
    # expanded trips
    rows = []
    for r in m.itertuples():
        t = r.s
        while t <= r.e:
            st_min = int(round(t / 60))
            rows.append((r.route_id, r.fs, r.ls, st_min, st_min + int(r.dur)))
            t += r.headway_secs
    T = pd.DataFrame(rows, columns=['route', 'fs', 'ls', 'start', 'end'])
    # route centroids for clustering
    coords = {}
    for rid, grp in T.groupby('route'):
        pts = [stops.loc[s, ['stop_lat', 'stop_lon']].values for s in set(grp.fs) | set(grp.ls) if s in stops.index]
        coords[rid] = np.mean(pts, axis=0)
    rids = sorted(coords)
    X = np.array([coords[r] for r in rids])
    # simple k-means (balanced-ish by trips via repeated init)
    rng = np.random.default_rng(seed)
    best = None
    w = T.groupby('route').size().reindex(rids).values
    for _ in range(30):
        C = X[rng.choice(len(X), n_clusters, replace=False)]
        for _ in range(50):
            lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
            C = np.array([X[lab == k].mean(0) if (lab == k).any() else C[k] for k in range(n_clusters)])
        loads = np.bincount(lab, weights=w, minlength=n_clusters)
        score = loads.std()
        if best is None or score < best[0]:
            best = (score, lab.copy())
    lab = dict(zip(rids, best[1]))
    insts = []
    for k in range(n_clusters):
        sub = T[T.route.map(lab) == k].sort_values('start').reset_index(drop=True)
        if len(sub) == 0:
            continue
        term = sorted(set(sub.fs) | set(sub.ls))
        txy = {s: stops.loc[s, ['stop_lat', 'stop_lon']].values.astype(float) for s in term}
        # merge terminal stops within merge_km into one relief point (opposite-direction stops)
        groups = []
        for s in term:
            for gq in groups:
                if _hav(txy[s], txy[gq[0]]) <= merge_km:
                    gq.append(s); break
            else:
                groups.append([s])
        pos = {}
        for i, gq in enumerate(groups):
            for s in gq:
                pos[s] = i + 1
        P = len(groups) + 1
        ll = np.array([np.mean([txy[s] for s in gq], axis=0) for gq in groups])
        depot_xy = ll.mean(0)
        allxy = np.vstack([depot_xy, ll])
        dist = np.zeros((P, P))
        for i in range(P):
            for j in range(P):
                dist[i, j] = change if i == j else change + round(_hav(allxy[i], allxy[j]) / speed_kmh * 60)
        # vehicle blocks per route: greedy chaining at terminals
        legs = []
        tour_id = 0
        for rid, grp in sub.groupby('route'):
            open_veh = []  # (ready_time, pos, tour)
            for r in grp.sort_values('start').itertuples():
                cand = [v for v in open_veh if v[1] == pos[r.fs] and v[0] + layover <= r.start]
                if cand:
                    v = min(cand, key=lambda v: r.start - v[0])
                    open_veh.remove(v); tid = v[2]
                else:
                    tour_id += 1; tid = tour_id
                legs.append(dict(tour=tid, start=int(r.start), end=int(r.end), sp=pos[r.fs], ep=pos[r.ls]))
                open_veh.append((int(r.end), pos[r.ls], tid))
        legs.sort(key=lambda x: (x['start'], x['tour']))
        for i, l in enumerate(legs):
            l['id'] = i
        insts.append(dict(name=f'rapidkl_R{k+1}', source='RapidKL', legs=legs, dist=dist,
                          depot=0, sign_on=15, sign_off=10,
                          routes=sorted(r for r in rids if lab[r] == k)))
    return insts


if __name__ == '__main__':
    base = os.path.join(os.path.dirname(__file__), '..', 'data')
    ks = load_rapidkl(f'{base}/gtfs')
    for i in ks:
        print(i['name'], len(i['legs']), 'tours', len({l['tour'] for l in i['legs']}), 'positions', len(i['dist']), 'routes', len(i['routes']))
