Paper 2 - Price-guided agent bidding for real-time bus crew rescheduling (Hybrid MAS + MILP)

Manuscript : Paper2_HybridMAS_MILP_CrewRescheduling.docx
Data       : collection.tar.gz (BDSP benchmark) and gtfs_rapid_bus_kl.zip (data.gov.my, CC BY 4.0) in the parent folder
Code (Python 3, numpy/scipy/pandas/matplotlib; manuscript builder needs Node.js + 'docx'):
  instances.py  load BDSP instances and build Rapid KL regional instances from GTFS
  model.py      driver rules, feasibility check, baseline duty construction
  disrupt.py    disruption scenario generator (LATE, DELAY, UNV, ABS)
  methods.py    CRSMAS, CRSMAS-MR, central MILP, HYB-S, HYB-PG (proposed)
  run.py        experiment runner: python3 run.py 0 2 res_0.csv  and  python3 run.py 1 2 res_1.csv
  analysis.py   statistics (Friedman, Wilcoxon-Holm), tables, figures, summary.json
  build_paper.js  builds the Word manuscript from the results
Folder layout expected by the code: code/ (scripts), data/bdsp/collection/*.json, data/gtfs/*.txt, results/
Results: res_0.csv + res_1.csv (420 scenarios x 5 methods), table_*.csv, summary.json, fig_*.png
