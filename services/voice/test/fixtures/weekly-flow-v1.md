`weekly-flow-v1.json.br` contains only the two source-generated graphs from
PR46 commit `48808c8c82a91b40123762aa4243cfaf900e8c8e`, keyed `first` and
`return`. Female roles have the same respective graph. No provider IDs,
credentials or caller data are included. Brotli avoids duplicating the large
shared prompt across phase nodes.

Generated in that source checkout with `weeklyFlow('first')` and
`weeklyFlow('return')`, JSON-encoded and compressed with Node's
`brotliCompressSync`. The portable graph SHA-256 values (after `flowGraph`
normalisation and recursive object-key sorting) are pinned in `weekly-flow-sync.ts`. Tests bind synthetic IDs
and exercise upgrades, idempotence and refusal of edited predecessor graphs.
