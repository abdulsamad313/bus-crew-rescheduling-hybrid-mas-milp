"""Experiment runner. Usage: python3 run.py SHARD NSHARDS OUTCSV"""
import sys, os, glob, csv, time, json
import methods as M
from instances import load_bdsp, load_rapidkl
from model import build_baseline, duty_times
from disrupt import make_scenario, apply

M.MILP_TL = 30.0
RHOS = [0.02, 0.05, 0.10, 0.20]
SEEDS = [11, 22, 33, 44, 55]
RES_FRAC = 0.02

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')


def instance_list():
    files = glob.glob(f'{BASE}/bdsp/collection/realistic_*.json')
    by_size = {}
    for f in files:
        sz = int(os.path.basename(f).split('_')[1])
        by_size.setdefault(sz, []).append(f)
    chosen = [sorted(v, key=lambda f: int(f.split('_')[-1][:-5]))[0] for _, v in sorted(by_size.items())]
    insts = [('BDSP', f) for f in chosen]
    insts += [('RapidKL', i) for i in range(8)]
    return insts


def main(shard, nsh, out):
    jobs = []
    for ii, (src, ref) in enumerate(instance_list()):
        for rho in RHOS:
            for sd in SEEDS:
                jobs.append((ii, src, ref, rho, sd))
    jobs = jobs[shard::nsh]
    rk = None; cache = {}
    done = set()
    if os.path.exists(out):
        for r in csv.DictReader(open(out)):
            done.add((r['instance'], r['rho'], r['seed'], r['method']))
    fields = None
    fh = open(out, 'a', newline='')
    w = None
    for ii, src, ref, rho, sd in jobs:
        if ii not in cache:
            if src == 'BDSP':
                I = load_bdsp(ref)
            else:
                if rk is None:
                    rk = load_rapidkl(f'{BASE}/gtfs')
                I = rk[ref]
            cache[ii] = (I, build_baseline(I))
        I, D = cache[ii]
        k = max(1, round(rho * len(D)))
        sc = make_scenario(I, D, k, seed=sd)
        rem, unc, dis = apply(I, D, sc)
        types = [e['type'] for e in sc['events']]
        for mname, f in M.METHODS.items():
            if (I['name'], str(rho), str(sd), mname) in done:
                continue
            ctx = M.Ctx(I, D, rem, unc, dis, sc['t0'], max(1, round(RES_FRAC * len(D))))
            r = f(ctx, sc['events'])
            row = dict(instance=I['name'], source=I['source'], n_legs=len(I['legs']),
                       n_tours=len({l['tour'] for l in I['legs']}), n_duties=len(D), rho=rho, seed=sd,
                       k=len(sc['events']), n_late=types.count('LATE'), n_delay=types.count('DELAY'),
                       n_unv=types.count('UNV'), n_abs=types.count('ABS'), n_agents=len(ctx.agents),
                       method=mname)
            for key in ['n_unc', 'n_coverable', 'covered', 'coverage', 'coverage_coverable', 'reserves',
                        'drivers_changed', 'violations', 'duplicates', 'conflicts', 'cpu', 'cpu_parallel',
                        'repaired', 'n_bids', 'rounds', 'milp_status', 'n_vars']:
                row[key] = r.get(key, '')
            if w is None:
                w = csv.DictWriter(fh, fieldnames=list(row.keys()))
                if fh.tell() == 0:
                    w.writeheader()
            w.writerow(row); fh.flush()
        print(time.strftime('%H:%M:%S'), I['name'], rho, sd, flush=True)


if __name__ == '__main__':
    main(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3])
