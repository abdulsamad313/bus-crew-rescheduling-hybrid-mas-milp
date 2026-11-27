# Price-guided agent bidding for real-time bus crew rescheduling

Code, instances and results for the paper:

**Price-guided agent bidding for real-time bus crew rescheduling under simultaneous disruptions**
Abdul Samad Shibghatullah (Universiti Tenaga Nasional), Tillal Eldabi (University of Bradford), Samer Muthana Sarsam (Coventry University)

The proposed method (HYB-PG) lets driver agents check labour rules locally and bid for bundles of disrupted trips, while a coordinator selects bids with a set-packing model and broadcasts LP dual prices, so that agent bidding acts as the pricing step of column generation. It is compared with CRSMAS, CRSMAS-MR, a centralised MILP and static bidding (HYB-S) on 420 disruption scenarios.

## Data
- Bus Driver Scheduling Problem benchmark: https://tommanmaz.github.io/bdsp.html
- Rapid Bus Kuala Lumpur GTFS static feed (CC BY 4.0): https://developer.data.gov.my/realtime-api/gtfs-static

Place the data as `data/bdsp/collection/*.json` and `data/gtfs/*.txt` next to the `code/` and `results/` folders.

## Code (Python 3: numpy, scipy, pandas, matplotlib)
| File | Purpose |
|---|---|
| `instances.py` | Loads BDSP instances and builds Rapid KL regional instances from GTFS |
| `model.py` | Labour rules, feasibility check, baseline duty construction |
| `disrupt.py` | Disruption scenario generator (late sign-on, delay, unavailability, absence) |
| `methods.py` | CRSMAS, CRSMAS-MR, central MILP, HYB-S and HYB-PG (proposed) |
| `run.py` | Experiment runner |
| `analysis.py` | Friedman and Wilcoxon–Holm tests, tables, figures, `summary.json` |

## Reproduce
    cd code
    pip install numpy scipy pandas matplotlib
    python3 run.py 0 2 ../results/res_0.csv
    python3 run.py 1 2 ../results/res_1.csv
    python3 analysis.py

## Results
`results/` holds the raw results (`res_0.csv`, `res_1.csv`: 420 scenarios × 5 methods), the summary tables (`table_*.csv`), `summary.json` and the figures.

## Licence
MIT. See `LICENSE`.
