"""
Pre-generate NPC voice lines with XTTS-v2 fine-tuned on Moldovan Romanian
(https://huggingface.co/FraPiz/xtts-v2-moldovan-romanian, Coqui Public Model License: non-commercial).

Each character gets its own voice, cloned from either
  tools/voices/<name>.wav       a real recording (~6-15 s, clean, ONE speaker, with their consent), or
  a stock XTTS-v2 studio speaker (speakers_xtts.pth from coqui/XTTS-v2) as fallback.
Output: assets/voice/<group>/<name>_<nn>.ogg + assets/voice/voices.js (text -> file manifest the game reads).

Usage (Python 3.11 venv with torch+CUDA, TTS==0.22.0, transformers<4.50, soundfile):
  python tools/gen_voices.py --model <dir with best_model.pth, config.json, vocab.json, generate_tts.py, speakers_xtts.pth>
  python tools/gen_voices.py --model ... --only Vasile      # regenerate one voice
  python tools/gen_voices.py --model ... --list-speakers    # show stock speaker names
"""
import argparse, importlib.util, json, os, sys, re
import numpy as np, soundfile as sf, torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF_DIR = os.path.join(ROOT, "tools", "voices")
OUT_DIR = os.path.join(ROOT, "assets", "voice")

# ---- what to say. Keep the text identical to the strings in the JS (the manifest is keyed by text).
GUARD_LINES = [  # js/linella_store.js: LST_ION_LINES + the two one-off lines
    "Stai, hoțule!", "Paza! Prindeți-l!", "Unde fugi, mă?!", "Dă înapoi marfa!", "Stai că chem poliția!",
    "Te văd, nu te ascunde!", "Hoțul! Hoțul!", "Lasă că te prind eu!", "Te-am prins! Dă banii!", "Stai! Dă încoace!",
]
# character -> stock speaker used when tools/voices/<name>.wav is missing (all male, different timbre/age)
GROUPS = {
    "guard": {
        "lines": GUARD_LINES,
        "voices": {
            "Ion": "Viktor Menelaos", "Vasile": "Damien Black", "Gheorghe": "Craig Gutsy",
            "Toader": "Baldur Sanjin", "Grigore": "Torcull Diarmuid", "Mitică": "Ludvig Milivoj",
        },
    },
}
SR = 24000


def slug(s):
    s = s.lower().translate(str.maketrans("ăâîșşțţ", "aaisstt"))
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


def load_model(mdir):
    spec = importlib.util.spec_from_file_location("gen_tts_ref", os.path.join(mdir, "generate_tts.py"))
    ref = importlib.util.module_from_spec(spec); spec.loader.exec_module(ref)
    ref.patch_tokenizer_for_romanian()           # adds "ro" to the XTTS tokenizer (edits the installed TTS package)
    import torchaudio
    def _sf_load(p, **kw):                       # avoid FFmpeg/torchcodec on Windows
        d, sr = sf.read(p, dtype="float32"); d = d[None, :] if d.ndim == 1 else d.T
        return torch.from_numpy(d), sr
    torchaudio.load = _sf_load
    _tl = torch.load                              # TTS 0.22 predates torch's weights_only=True default; files are local+trusted
    torch.load = lambda *a, **k: _tl(*a, **{**k, "weights_only": False})
    from TTS.tts.configs.xtts_config import XttsConfig
    from TTS.tts.models.xtts import Xtts
    cfg = XttsConfig(); cfg.load_json(os.path.join(mdir, "config.json"))
    m = Xtts.init_from_config(cfg)
    m.load_checkpoint(cfg, checkpoint_dir=mdir, checkpoint_path=os.path.join(mdir, "best_model.pth"), vocab_path=os.path.join(mdir, "vocab.json"), use_deepspeed=False)
    m.cuda().eval()
    return m, ref.CEDILLA_TO_COMMA


def latents(model, stock, name, speaker):
    wav = os.path.join(REF_DIR, slug(name) + ".wav")
    if os.path.exists(wav):
        g, s = model.get_conditioning_latents(audio_path=[wav], gpt_cond_len=6)
        return g, s, "recording " + os.path.relpath(wav, ROOT)
    if speaker is None: raise SystemExit(f"{name}: needs a recording at {os.path.relpath(wav, ROOT)}")
    d = stock[speaker]
    return d["gpt_cond_latent"].cuda(), d["speaker_embedding"].cuda(), "stock " + speaker


def cut_tail(w, chars):
    """XTTS often adds a babbled tail after short lines: cut at the first pause (>=0.28 s) once the line had time to be said"""
    n = int(.02 * SR); e = np.array([np.sqrt(np.mean(w[i:i + n] ** 2)) for i in range(0, len(w) - n, n)])
    if not len(e): return w
    quiet = e < max(.004, e.max() * .06); start = np.argmax(~quiet); min_i = start + int((.06 * chars + .25) / .02); run = 0
    for i in range(start, len(e)):
        run = run + 1 if quiet[i] else 0
        if run >= 14 and i - run >= min_i: return w[: (i - run + 6) * n]
    return w


def tidy(w, chars):
    """cut the babble tail, trim leading/trailing silence, short fades, peak-normalise to -1 dBFS"""
    w = cut_tail(w, chars)
    a = np.abs(w); thr = max(1e-3, a.max() * 0.02); idx = np.where(a > thr)[0]
    if len(idx): w = w[max(0, idx[0] - int(.03 * SR)): idx[-1] + int(.12 * SR)]
    f = min(len(w) // 4, int(.01 * SR)); w = w.copy()
    if f: w[:f] *= np.linspace(0, 1, f); w[-f:] *= np.linspace(1, 0, f)
    return (w / (np.abs(w).max() + 1e-9) * 0.89).astype(np.float32)


def say(model, ced, text, g, s):
    """XTTS sometimes rambles or cuts short on very short prompts: retry until the length is plausible"""
    best = None
    for k in range(4):
        torch.manual_seed(1234 + k)
        with torch.no_grad():
            out = model.inference(text.translate(ced), "ro", g, s, temperature=0.7, top_p=0.7, top_k=30, length_penalty=1.0, repetition_penalty=10.0, speed=1.1)
        chars = len(re.sub(r"[^\wăâîșț]", "", text.lower()))
        w = tidy(np.asarray(out["wav"].cpu() if torch.is_tensor(out["wav"]) else out["wav"]).squeeze(), chars)
        dur = len(w) / SR
        ok = 0.045 * chars + 0.25 < dur < 0.13 * chars + 0.9
        if ok: return w
        if best is None or abs(dur - 0.08 * chars) < abs(len(best) / SR - 0.08 * chars): best = w
    print("    ! no take with a plausible length, keeping the closest one")
    return best


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(); ap.add_argument("--model", required=True); ap.add_argument("--only"); ap.add_argument("--list-speakers", action="store_true")
    a = ap.parse_args()
    stock = torch.load(os.path.join(a.model, "speakers_xtts.pth"), weights_only=False)
    if a.list_speakers: print("\n".join(sorted(stock))); return
    model, ced = load_model(a.model)
    man_path = os.path.join(OUT_DIR, "voices.js"); manifest = {}
    if os.path.exists(man_path):
        manifest = json.loads(open(man_path, encoding="utf8").read().split("=", 1)[1].rstrip().rstrip(";"))
    for grp, G in GROUPS.items():
        os.makedirs(os.path.join(OUT_DIR, grp), exist_ok=True)
        for name, speaker in G["voices"].items():
            if a.only and a.only != name: continue
            g, s, src = latents(model, stock, name, speaker); print(f"[{grp}] {name}: {src}")
            files = {}
            for i, text in enumerate(G["lines"]):
                rel = f"assets/voice/{grp}/{slug(name)}_{i:02d}.ogg"
                sf.write(os.path.join(ROOT, rel), say(model, ced, text, g, s), SR, format="OGG", subtype="VORBIS")
                files[text] = rel; print(f"    {rel}  {text}")
            manifest.setdefault(grp, {})[name] = files
    with open(man_path, "w", encoding="utf8", newline="\n") as f:
        f.write("// generated by tools/gen_voices.py: character voice lines (XTTS-v2 Moldovan, Coqui Public Model License, non-commercial)\n")
        f.write("window.NPC_VOICES=" + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n")
    print("manifest:", os.path.relpath(man_path, ROOT))


if __name__ == "__main__":
    main()
