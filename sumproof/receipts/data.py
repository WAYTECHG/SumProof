"""Load CORD-v2 (800 train / 100 val / 100 test receipt photos, CC-BY-4.0)."""

from __future__ import annotations

from datasets import load_dataset

from .schema import Receipt, from_cord

DATASET_ID = "naver-clova-ix/cord-v2"


def load_split(split: str, limit: int | None = None):
    """Yield (PIL image, gold Receipt) pairs for a CORD split."""
    ds = load_dataset(DATASET_ID, split=split)
    if limit:
        ds = ds.select(range(min(limit, len(ds))))
    for row in ds:
        yield row["image"].convert("RGB"), from_cord(row["ground_truth"])


class LazySplit:
    """Index into a CORD split without decoding every photo up front.

    Training used list(load_split("train")), which kept all 800 decoded photos in RAM
    and, together with other apps, ran Windows out of memory. This decodes one receipt
    per access instead.
    """

    def __init__(self, split: str, limit: int | None = None):
        ds = load_dataset(DATASET_ID, split=split)
        self.ds = ds.select(range(min(limit, len(ds)))) if limit else ds

    def __len__(self) -> int:
        return len(self.ds)

    def __getitem__(self, i: int):
        row = self.ds[int(i)]
        return row["image"].convert("RGB"), from_cord(row["ground_truth"])


def gold_consistency_rate(split: str = "test") -> float:
    """Share of gold labels that pass every rule.

    Report this next to the results: it is the ceiling for how much the
    consistency signal can be trusted on this dataset (some printed receipts
    are themselves inconsistent, e.g. odd discount lines).
    """
    from .consistency import check

    golds: list[Receipt] = [g for _, g in load_split(split)]
    return sum(check(g).consistent for g in golds) / len(golds)
