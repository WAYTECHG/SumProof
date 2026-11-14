"""Qwen3.5-4B wrapper for receipt extraction: 4-bit loading, prompting, sampling, scoring.

Qwen3.5 (Feb 2026) is a natively multimodal model whose language layers mix
Gated DeltaNet (linear attention, 24 layers) with standard attention (8 layers).
Its fast linear-attention kernels need Triton, so run this under Linux/WSL2.

Memory notes for an 8 GB GPU:
- language layers in 4-bit NF4; the vision encoder (0.33B) stays in bf16;
- the vocabulary has 248k tokens, so we never materialise logits for the whole
  sequence: training keeps only the answer positions (logits_to_keep), and
  candidate log-probs are computed per candidate after generation.
"""

from __future__ import annotations

import os

import torch
import torch.nn.functional as F
from transformers import AutoModelForImageTextToText, AutoProcessor, BitsAndBytesConfig

from .schema import Receipt, parse_model_output

BASE_MODEL = os.environ.get("SUMPROOF_VLM", "Qwen/Qwen3.5-4B")
TOKEN_PX = 32  # 16 px patches merged 2x2 -> one visual token per 32x32 pixels
MIN_PIXELS = 256 * TOKEN_PX * TOKEN_PX
MAX_PIXELS = 800 * TOKEN_PX * TOKEN_PX  # at most ~800 visual tokens per receipt

PROMPT = (
    "Read this receipt and return ONLY a JSON object with these keys when they are printed: "
    '"items" (list of {"name","qty","unit_price","amount"}), "subtotal", "discount", "service", '
    '"tax", "total", "cash", "change", "card". Copy every value exactly as printed, as strings. '
    "Leave out keys that are not on the receipt."
)


def bnb_config() -> BitsAndBytesConfig:
    return BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
        llm_int8_skip_modules=["visual", "lm_head"],  # vision encoder stays bf16 (fast + accurate)
    )


def load(adapter: str | None = None):
    model = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL, quantization_config=bnb_config(), dtype=torch.bfloat16, device_map="cuda:0"
    )
    if adapter:
        from peft import PeftModel

        model = PeftModel.from_pretrained(model, adapter)
    model.eval()
    processor = AutoProcessor.from_pretrained(BASE_MODEL)
    processor.image_processor.size = {"shortest_edge": MIN_PIXELS, "longest_edge": MAX_PIXELS}
    return model, processor


def prompt_text(processor) -> str:
    msgs = [{"role": "user", "content": [{"type": "image"}, {"type": "text", "text": PROMPT}]}]
    # Thinking is on by default in Qwen3.5; extraction needs a direct answer.
    return processor.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)


def answer_suffix(processor) -> str:
    return processor.tokenizer.decode([processor.tokenizer.eos_token_id])


def encode_prompt(processor, image, device):
    return processor(text=[prompt_text(processor)], images=[image], return_tensors="pt").to(device)


@torch.inference_mode()
def sequence_logprob(model, inputs, gen_ids: torch.Tensor) -> float:
    """Mean log-prob of generated tokens, from one teacher-forced pass (answer positions only)."""
    n = gen_ids.shape[0]
    if n == 0:
        return float("-inf")
    prompt_len = inputs["input_ids"].shape[1]
    ids = torch.cat([inputs["input_ids"][0], gen_ids]).unsqueeze(0)
    batch = {}
    for k, v in inputs.items():
        if k in ("input_ids", "attention_mask"):
            continue
        # Per-token fields (Qwen3.5's mm_token_type_ids: 0 = text, >0 = image/video) must cover
        # the appended answer tokens too, or rope position indexing fails on a length mismatch.
        if torch.is_tensor(v) and v.dim() == 2 and v.shape[1] == prompt_len:
            v = torch.cat([v, torch.zeros((1, n), dtype=v.dtype, device=v.device)], dim=1)
        batch[k] = v
    out = model(input_ids=ids, attention_mask=torch.ones_like(ids), logits_to_keep=n + 1, **batch)
    logp = F.log_softmax(out.logits[0, :-1].float(), dim=-1)  # positions predicting each generated token
    return float(logp.gather(1, gen_ids.unsqueeze(1)).mean())


@torch.inference_mode()
def generate(model, processor, image, n_samples: int = 0, temperature: float = 0.7, max_new_tokens: int = 768):
    """Return [(raw_text, mean_logprob)]: greedy first, then n_samples sampled candidates."""
    inputs = encode_prompt(processor, image, model.device)
    prompt_len = inputs["input_ids"].shape[1]
    pad = processor.tokenizer.pad_token_id
    eos = processor.tokenizer.eos_token_id

    runs = [dict(do_sample=False, num_return_sequences=1)]
    if n_samples:
        runs.append(dict(do_sample=True, temperature=temperature, top_p=0.95, num_return_sequences=n_samples))

    results = []
    for kw in runs:
        seqs = model.generate(**inputs, max_new_tokens=max_new_tokens, **kw)
        for seq in seqs:
            gen = seq[prompt_len:]
            gen = gen[(gen != pad)]
            if eos is not None and (gen == eos).any():
                gen = gen[: int((gen == eos).nonzero()[0]) + 1]
            text = processor.decode(gen, skip_special_tokens=True)
            lp = sequence_logprob(model, inputs, gen) if n_samples else 0.0
            results.append((text, lp))
    return results


def extract(model, processor, image, n_samples: int = 0) -> tuple[Receipt | None, list]:
    """Greedy extraction, or verifier-guided best-of-N when n_samples > 0.

    Returns the chosen receipt and every candidate as (receipt or None, mean log-prob, raw text).
    """
    from .consistency import rerank

    outs = generate(model, processor, image, n_samples=n_samples)
    candidates = [(parse_model_output(t), lp, t) for t, lp in outs]
    if n_samples == 0:
        return candidates[0][0], candidates
    chosen, _ = rerank([(r, lp) for r, lp, _ in candidates])
    return chosen, candidates
