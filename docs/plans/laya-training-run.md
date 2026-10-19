# Laya: fine-tune and activate a checkpoint

## Goal
Turn the collected corrections into a fine-tuned Laya checkpoint and serve it, with an
easy way back to the original.

## Known
- Activity → "More exports" → "Laya training data" downloads `laya-train.jsonl` /
  `laya-eval.jsonl` (`layers/automation-laya/server/api/automation/laya/training-data.get.ts`).
  Labels: human checks > accepted suggestions > rejected single-decision suggestions >
  (opt-in) sure AI answers. Verified with `laya-train --dry-run` in the container.
- laya 0.4.11 in the ddev `laya` container (CPU only): `laya-train --data … --eval …
  --base multilingual --out <dir>`; 4 epochs, keeps a calibration slice.
- `LAYA_EXTRA_MODELS='{"multilingual": "<dir>"}'` re-points the `multilingual` name to a
  local checkpoint; the dashboard needs no change.
- Training time on this CPU is not measured.

## When
Only once the summary shows at least a few dozen labels per option of the questions
that matter. Before that, better instructions/thresholds help more.

## Steps
1. Download both files; copy them into the container
   (`docker cp … ddev-allmight-laya:/home/laya/data/`).
2. Measure first: `laya-train --data train.jsonl --eval eval.jsonl --base multilingual
   --out /home/laya/.cache/huggingface/finetunes/<date>` — note duration and the
   before/after eval numbers. Write the checkpoint into the `laya-models` volume so it
   survives rebuilds.
3. Only if eval improved: add `LAYA_EXTRA_MODELS` to `.ddev/docker-compose.laya.yaml`
   (environment of the laya service) and restart that container.
4. Way back: remove the variable and restart; the original checkpoint stays in the volume.
5. Optional later: a script (`.ddev/commands/web/laya-train`) that does 1–2 in one go.

## Verify
The eval numbers; afterwards a workflow preview on known mails gives the same or better
answers than before.
