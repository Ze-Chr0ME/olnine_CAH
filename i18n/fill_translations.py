"""Fill reviewed null cards via Google Translate: python fill_translations.py --langs fr.

Use --dry-run to list pending cards without network requests or file writes.
"""

import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import urllib.parse
import urllib.request


def serialize(data):
    return "{\n" + ",\n".join(
        f"  {json.dumps(k)}: "
        + json.dumps(v, ensure_ascii=False, separators=(",", ":"))
        for k, v in data.items()
    ) + "\n}\n"


def translate(text, target):
    query = urllib.parse.urlencode(
        {"client": "gtx", "sl": "en", "tl": target, "dt": "t", "q": text}
    )
    with urllib.request.urlopen(
        f"https://translate.googleapis.com/translate_a/single?{query}", timeout=10
    ) as resp:
        return "".join(segment[0] for segment in json.load(resp)[0])


def save_atomic(path, data):
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=path.parent,
            prefix=path.name + ".", suffix=".tmp", delete=False,
        ) as stream:
            temporary = stream.name
            stream.write(serialize(data))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and os.path.exists(temporary):
            os.unlink(temporary)


def nonnegative(value):
    value = float(value)
    if not 0 <= value < float("inf"):
        raise argparse.ArgumentTypeError("delay must be finite and nonnegative")
    return value


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    base = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, default=base / "untranslated-review/official.json")
    parser.add_argument("--i18n-dir", type=Path, default=base)
    parser.add_argument("--langs", nargs="+")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delay", type=nonnegative, default=0.5)
    args = parser.parse_args(argv)
    with args.review.open(encoding="utf-8") as stream:
        entries = json.load(stream)
    languages = dict.fromkeys(
        lang for entry in entries for lang in entry["missing_languages"]
        if args.langs is None or lang in args.langs
    )
    cards, paths, totals = {}, {}, {}
    for lang in languages:
        paths[lang] = args.i18n_dir / f"cards.{lang}.json"
        totals[lang] = dict(filled=0, already=0, failed=0, skipped=0, pending=0)
        try:
            with paths[lang].open(encoding="utf-8") as stream:
                cards[lang] = json.load(stream)
        except (OSError, ValueError) as exc:
            print(f"WARNING [{lang}] cannot load {paths[lang]}: {exc}")
    changed = set()
    last_request = None
    interrupted = False
    try:
        for entry in entries:
            for lang in dict.fromkeys(entry["missing_languages"]):
                if lang not in languages:
                    continue
                counts = totals[lang]
                pack, kind, index = entry["pack_id"], entry["kind"], entry["index"]
                label = f"[{lang}] {pack}/{kind}/{index}"
                slots = cards.get(lang, {}).get(pack, {}).get(kind)
                if (not isinstance(slots, list) or not isinstance(index, int)
                        or not 0 <= index < len(slots)):
                    counts["skipped"] += 1
                    print(f"WARNING {label}: missing pack/kind or invalid index; skipped")
                    continue
                if slots[index] is not None:
                    counts["already"] += 1
                    print(f"{label}: already translated")
                    continue
                english = entry["english"]
                if args.dry_run:
                    counts["pending"] += 1
                    print(f"{label}: would translate {english}")
                    continue
                for attempt in range(3):
                    try:
                        if last_request is not None:
                            time.sleep(max(0, args.delay - (time.monotonic() - last_request)))
                        last_request = time.monotonic()
                        result = translate(english, lang)
                        if not isinstance(result, str):
                            raise ValueError("translation is not a string")
                        break
                    except Exception as exc:
                        print(f"{label}: request {attempt + 1}/3 failed: {exc}")
                        if attempt < 2:
                            time.sleep(2 ** attempt)
                else:
                    counts["failed"] += 1
                    continue
                if result.count("____") != english.count("____"):
                    counts["failed"] += 1
                    print(f"{label}: blank mismatch; left null")
                    continue
                slots[index] = result
                changed.add(lang)
                counts["filled"] += 1
                print(f"{label}: filled {result}")
    except KeyboardInterrupt:
        interrupted = True
        print("\nInterrupted; saving completed translations.")
    finally:
        save_errors = []
        for lang in languages:
            if lang in changed:
                try:
                    save_atomic(paths[lang], cards[lang])
                except OSError as exc:
                    save_errors.append(lang)
                    print(f"ERROR [{lang}] could not save: {exc}")
        for lang, counts in totals.items():
            print(f"[{lang}] filled: {counts['filled']} / already translated: "
                  f"{counts['already']} / failed: {counts['failed']} / skipped: "
                  f"{counts['skipped']}"
                  + (f" / pending: {counts['pending']}" if args.dry_run else ""))
    return 130 if interrupted else (1 if save_errors else 0)


if __name__ == "__main__":
    raise SystemExit(main())
