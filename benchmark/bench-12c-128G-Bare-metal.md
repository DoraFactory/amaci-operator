# Benchmark: 12c-128G Bare-metal

## Environment
- Operator version: v1.4.1
- Commit: f0e5c8189983be6ab8632021e530786456097b7a
- OS: ubuntu
- CPU: 12C
- RAM: 128GB
- Disk: 2TB
- WORK_PATH: 
- Prover concurrency: 
- Config summary (pipeline/concurrency/submit batch): 
- cost/month：180$   ===>   cost/min: 0.0042$


## Round 2-1-1-5

concurrency: 3

### Data
| Round ID | Voters | Votes per participant | Total votes | Msg count | DMsg count | Tally duration (s) | Notes | Tally cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dora1wsld3ljn5wsntm2k8xc0zg9psdxdlu73eu9wud4au8ndletcft4qfx9vc9 | 25 | 5 | 125 |  |  | 2m 30s |  | 0.013$ |

Fee cost: 0.014 * 11 = 0.16DORA -> 0.2DORA

总成本：0.02$ + 0.2DORA

- CPU: Peak at 73%
- MEM: ~16GB
![machine-status](image.png)




## Round 4-2-2-25

concurrency: 2

### Data
| Round ID | Voters | Votes per participant | Total votes | Msg count | DMsg count | Tally duration (s) | Notes | Tally cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
|dora1yf3qa43zxxv96w6c96c6delntd63mtvkwdj92nka4xn6xqj4433qw2lsmy | 625 | 20 | 12500 |  |  | 160m |  | 0.7$ |

625*25-> 160m + 70m = 230m   ->  0.966 $ -> 1$

Fee cost: 3.26DORA -> 4DORA

总成本：1$ + 4DORA



- CPU: Peak reaches 95%+
- MEM: Reaches 20GB
![machine-status](image-2.png)




## Comparasion
Original Tally cost + gas fee:

- 2-1-1-5: $0.2
- 4-2-2-25: $7.5

Current Tally cost + gas fee:

- 2-1-1-5: $0.02 (reduced by 10 times)
- 4-2-2-25: $1 (reduced by 7.5 times)

If considering the idle machine sharing, it expands by 10 times, which is $0.2 and $10 respectively.

According to DORA = $0.1:

- 2-1-1-5: 2 DORA
- 4-2-2-25: 100 DORA

Variables:

- Proportion of idle sharing: currently set at 10 times
- DORA unit price: $0.1