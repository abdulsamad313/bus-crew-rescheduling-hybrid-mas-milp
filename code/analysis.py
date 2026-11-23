"""Statistical analysis, tables and figures for the paper."""
import glob, os, json
import numpy as np, pandas as pd
from scipy.stats import friedmanchisquare, wilcoxon
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results')
FIG = os.path.join(R, 'fig'); os.makedirs(FIG, exist_ok=True)
ORDER = ['CRSMAS', 'CRSMAS-MR', 'MILP', 'HYB-S', 'HYB-PG']
LABEL = {'CRSMAS': 'CRSMAS', 'CRSMAS-MR': 'CRSMAS-MR', 'MILP': 'Central MILP', 'HYB-S': 'HYB-S', 'HYB-PG': 'HYB-PG'}

df = pd.concat([pd.read_csv(f) for f in glob.glob(f'{R}/res_*.csv')], ignore_index=True)
df['scen'] = df.instance + '|' + df.rho.astype(str) + '|' + df.seed.astype(str)
df['size'] = np.where(df.n_legs < 500, 'small (<500 legs)', np.where(df.n_legs < 1200, 'medium (500-1199)', 'large (>=1200)'))
out = {}

# ---- completeness
cnt = df.groupby('scen').method.nunique()
out['n_scenarios'] = int((cnt == len(ORDER)).sum())
df = df[df.scen.isin(cnt[cnt == len(ORDER)].index)]
out['n_instances'] = int(df.instance.nunique())
out['bdsp_instances'] = int(df[df.source == 'BDSP'].instance.nunique())
out['rk_instances'] = int(df[df.source == 'RapidKL'].instance.nunique())

# ---- instance table
inst = df.drop_duplicates('instance')[['instance', 'source', 'n_legs', 'n_tours', 'n_duties']].sort_values(['source', 'n_legs'])
inst.to_csv(f'{R}/table_instances.csv', index=False)

# ---- main table: by source x rho
def agg(g):
    return pd.Series(dict(coverage=100 * g.coverage_coverable.mean(), reserves=g.reserves.mean(),
                          changed=g.drivers_changed.mean(), conflicts=g.conflicts.mean(),
                          cpu=g.cpu.mean(), cpu_max=g.cpu.max(), viol=g.violations.sum() + g.duplicates.sum()))
main = df.groupby(['source', 'rho', 'method']).apply(agg).reset_index()
main.to_csv(f'{R}/table_main.csv', index=False)
overall = df.groupby('method').apply(agg).reindex(ORDER)
overall.to_csv(f'{R}/table_overall.csv')
size_tab = df.groupby(['size', 'method']).apply(agg).reset_index()
size_tab.to_csv(f'{R}/table_size.csv', index=False)

# disruption stats
sc = df.drop_duplicates('scen')
out['events_total'] = int(sc.k.sum())
out['events_by_type'] = {t: int(sc[c].sum()) for t, c in [('LATE', 'n_late'), ('DELAY', 'n_delay'), ('UNV', 'n_unv'), ('ABS', 'n_abs')]}
out['uncovered_mean'] = float(sc.n_unc.mean()); out['coverable_share'] = float(sc.n_coverable.sum() / sc.n_unc.sum())

# ---- statistics: Friedman + Wilcoxon (Holm) on coverage and on drivers changed
def holm(p):
    p = np.array(p); o = np.argsort(p); m = len(p); adj = np.empty(m); cur = 0
    for r, i in enumerate(o):
        cur = max(cur, min(1, (m - r) * p[i])); adj[i] = cur
    return adj

stats = {}
for metric in ['coverage_coverable', 'drivers_changed', 'cpu']:
    piv = df.pivot_table(index='scen', columns='method', values=metric)[ORDER].dropna()
    fr = friedmanchisquare(*[piv[m] for m in ORDER])
    ranks = piv.rank(axis=1, ascending=(metric != 'coverage_coverable')).mean()
    pairs = []
    for m in ORDER:
        if m == 'HYB-PG':
            continue
        d = piv['HYB-PG'] - piv[m]
        if (d != 0).sum() == 0:
            pairs.append((m, 1.0, 0, 0, 0)); continue
        p = wilcoxon(piv['HYB-PG'], piv[m], zero_method='wilcox').pvalue
        pairs.append((m, p, int((d > 0).sum()), int((d == 0).sum()), int((d < 0).sum())))
    adj = holm([p for _, p, *_ in pairs])
    stats[metric] = dict(friedman_chi2=float(fr.statistic), friedman_p=float(fr.pvalue), n=len(piv),
                         mean_rank={m: float(ranks[m]) for m in ORDER},
                         wilcoxon=[dict(vs=m, p=float(p), p_holm=float(a), win=w, tie=t, loss=l)
                                   for (m, p, w, t, l), a in zip(pairs, adj)])
out['stats'] = stats

# MILP timeouts and HYB-PG gap to MILP when MILP proved optimal
milp = df[df.method == 'MILP']
out['milp_timeouts'] = int((milp.milp_status == 1).sum())
out['milp_scen'] = int(len(milp))
pv = df.pivot_table(index='scen', columns='method', values='covered')
st = milp.set_index('scen').milp_status
opt = st[st == 0].index
gap = (pv.loc[opt, 'MILP'] - pv.loc[opt, 'HYB-PG'])
out['hybpg_vs_milp_opt'] = dict(n=int(len(opt)), equal=int((gap == 0).sum()), hyb_better=int((gap < 0).sum()),
                                milp_better=int((gap > 0).sum()), max_gap=int(gap.max()) if len(gap) else 0)
tmo = st[st == 1].index
g2 = (pv.loc[tmo, 'HYB-PG'] - pv.loc[tmo, 'MILP'])
out['hybpg_vs_milp_timeout'] = dict(n=int(len(tmo)), hyb_better=int((g2 > 0).sum()), mean_extra_legs=float(g2.mean()) if len(g2) else 0)
out['milp_repaired_total'] = int(milp.repaired.fillna(0).sum())
hp = df[df.method == 'HYB-PG']
out['hybpg_rounds_mean'] = float(hp['rounds'].mean()); out['hybpg_bids_mean'] = float(hp.n_bids.mean())
out['hybpg_cpu_parallel_mean'] = float(hp.cpu_parallel.mean())
cr = df[df.method == 'CRSMAS']
out['crsmas_conflict_share'] = float((cr.conflicts > 0).mean())
json.dump(out, open(f'{R}/summary.json', 'w'), indent=1, default=float)

# ---- figures
plt.rcParams.update({'font.size': 9, 'font.family': 'DejaVu Sans'})
cols = {'CRSMAS': '#9e9e9e', 'CRSMAS-MR': '#6a8caf', 'MILP': '#d98c3c', 'HYB-S': '#8fbf8f', 'HYB-PG': '#2e7d32'}
fig, axes = plt.subplots(1, 2, figsize=(7.2, 3.1), sharey=True)
for ax, src in zip(axes, ['BDSP', 'RapidKL']):
    s = main[main.source == src]
    for m in ORDER:
        v = s[s.method == m].sort_values('rho')
        ax.plot(100 * v.rho, v.coverage, marker='o', ms=3.5, lw=1.4, color=cols[m], label=LABEL[m])
    ax.set_title('BDSP benchmark' if src == 'BDSP' else 'Rapid Bus KL (GTFS)')
    ax.set_xlabel('Drivers disrupted (%)'); ax.grid(alpha=.3); ax.set_xticks([2, 5, 10, 20])
axes[0].set_ylabel('Recovered trips (% of recoverable)')
h_, l_ = axes[0].get_legend_handles_labels()
fig.legend(h_, l_, loc='lower center', ncol=5, frameon=False, fontsize=7.5)
fig.tight_layout(rect=(0, 0.08, 1, 1)); fig.savefig(f'{FIG}/fig_coverage.png', dpi=300); plt.close(fig)

fig, ax = plt.subplots(figsize=(4.2, 3.0))
for m in ORDER:
    s = df[df.method == m].groupby('n_legs').cpu.mean()
    ax.plot(s.index, s.values, marker='o', ms=3, lw=1.2, color=cols[m], label=LABEL[m])
ax.set_yscale('log'); ax.set_xlabel('Instance size (trips)'); ax.set_ylabel('Mean CPU time (s, log)')
ax.axhline(30, ls='--', lw=.8, color='k'); ax.text(60, 33, 'MILP time limit (30 s)', fontsize=7)
ax.grid(alpha=.3, which='both'); ax.legend(frameon=False, fontsize=7)
fig.tight_layout(); fig.savefig(f'{FIG}/fig_cpu.png', dpi=300); plt.close(fig)

fig, ax = plt.subplots(figsize=(4.2, 3.0))
cr_ = df[df.method == 'CRSMAS'].copy()
bins = [0, 5, 10, 20, 40, 80]; labs = ['1–5', '6–10', '11–20', '21–40', '41–80']
cr_['kb'] = pd.cut(cr_.k, bins, labels=labs)
c = cr_.groupby('kb', observed=False).conflicts.mean()
n = cr_.groupby('kb', observed=False).size()
bars = ax.bar(labs, c.values, color='#9e9e9e')
for b_, v, nn in zip(bars, c.values, n.values):
    ax.text(b_.get_x() + b_.get_width() / 2, v + 0.5, f'{v:.1f}', ha='center', fontsize=7.5)
ax.set_xlabel('Simultaneous events (k)'); ax.set_ylabel('Mean conflicts per scenario')
ax.grid(alpha=.3, axis='y')
fig.tight_layout(); fig.savefig(f'{FIG}/fig_conflicts.png', dpi=300); plt.close(fig)
out['conflicts_by_k'] = {l: float(v) for l, v in zip(labs, c.values)}
json.dump(out, open(f'{R}/summary.json', 'w'), indent=1, default=float)
print(json.dumps(out, indent=1, default=float)[:3000])
