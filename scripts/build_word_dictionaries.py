#!/usr/bin/env python3
from __future__ import annotations

import json
import re
from pathlib import Path

import pymorphy3
from wordfreq import top_n_list, zipf_frequency


ROOT = Path(__file__).resolve().parents[1]
DICT_DIR = ROOT / "dictionaries"
WORDS_JS = ROOT / "words.js"

WORD_LEN = 5
MIN_ANSWERS = 3001

RU_RE = re.compile(r"^[а-яё]{5}$")
BAD_NAME_TAGS = {"Name", "Surn", "Patr", "Geox", "Orgn", "Trad", "Abbr"}
BAD_STYLE_TAGS = {"Arch", "Infr", "Slng", "Obsc", "Erro", "Dist", "Vulg"}

# Add a small curated tail of still-common words so answers stay >3000
# without going too deep into low-frequency/obscure nouns.
MANUAL_ANSWER_ADDITIONS = {
    "ковер",
    "козел",
    "копье",
    "тапок",
    "щетка",
    "эркер",
    "кирза",
    "пряха",
    "чумка",
    "валек",
    "лузга",
    "ложок",
    "нанос",
    "засол",
    "фиорд",
    "фланк",
    "ветла",
    "липид",
    "тенек",
    "щелок",
    "ненец",
    "бронх",
    "ухват",
    "щучка",
    "латка",
    "фаска",
    "желоб",
    "ляжка",
    "тапка",
    "пакля",
    "ватка",
    "опока",
    "цанга",
    "бахча",
    "кочет",
    "моляр",
    "утеха",
    "полба",
    "донка",
    "лабаз",
    "вазон",
    "жабка",
    "газик",
    "плаун",
    "тулья",
    "чебак",
    "салеп",
    "розга",
    "фибра",
    "циста",
    "букса",
    "вервь",
    "тапер",
    "шакша",
    "ивняк",
    "кобза",
    "багаж",
    "банка",
    "вагон",
    "ворот",
    "какао",
    "майка",
    "манго",
    "метро",
    "мороз",
    "профи",
    "пульт",
    "радио",
    "рельс",
    "сапог",
    "север",
    "тапок",
    "устав",
    "ферма",
    "чайка",
    "череп",
    "честь",
}

# Remove ambiguous / unfair "answers" that read like other parts of speech
# or proper-name-like forms in common usage.
MANUAL_ANSWER_EXCLUSIONS = {
    "знать",
    "стать",
    "новое",
    "погиб",
    "живой",
    "белые",
    "чувак",
    "генри",
    "оскар",
    "парка",
    "тепло",
    "добро",
    "алкаш",
    "бабло",
    "шлюха",
    "айфон",
    "шкода",
    "фуфло",
    "шпана",
    "шобла",
    "юлиус",
    "юникс",
    "экшен",
    "айван",
    "кацап",
    "жулье",
    "авгит",
    "автол",
    "аймак",
    "аймар",
    "акрон",
    "аксес",
    "аргал",
    "армяк",
    "артос",
    "аэроб",
    "бабай",
    "шугай",
    "шухер",
    "шудра",
    "шорец",
    "этвеш",
    "эшпай",
    "эоцен",
    "эмбол",
    "эрбий",
    "эозин",
    "эйдос",
    "юкола",
    "юннат",
    "ямаец",
    "ясырь",
}


def norm(word: str) -> str:
    return word.lower().replace("ё", "е")


def is_clean_noun_tag(tag) -> bool:
    grams = set(tag.grammemes)
    if BAD_NAME_TAGS & grams:
        return False
    if BAD_STYLE_TAGS & grams:
        return False
    return True


def to_upper_sorted(words: set[str]) -> list[str]:
    return sorted({w.upper() for w in words})


def write_txt(path: Path, words_upper: list[str]) -> None:
    path.write_text("\n".join(words_upper), encoding="utf-8")


def write_words_js(path: Path, answers_upper: list[str], allowed_upper: list[str]) -> None:
    # Keep runtime static/simple for GitHub Pages.
    lines = [
        "(() => {",
        f"  const SOLUTIONS = {json.dumps(answers_upper, ensure_ascii=False)};",
        f"  const ALLOWED = {json.dumps(allowed_upper, ensure_ascii=False)};",
        "",
        "  window.WORDLY_SOLUTION_WORDS = SOLUTIONS;",
        "  window.WORDLY_ALLOWED_WORDS = ALLOWED;",
        "})();",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    morph = pymorphy3.MorphAnalyzer()

    # All nominative nouns (sing+plur) for ALLOWED.
    allowed_freq: dict[str, float] = {}
    # Lemma-level nominative singular nouns for answer base.
    singular_lemma_freq: dict[str, float] = {}
    # Pluralia tantum nouns (nominative plural) to allow a small justified share.
    pltm_freq: dict[str, float] = {}

    for word, tag, normal_form, _para_id, _idx in morph.dictionary.iter_known_words(prefix=""):
        if tag.POS != "NOUN":
            continue
        if "nomn" not in tag:
            continue
        if not is_clean_noun_tag(tag):
            continue
        if not RU_RE.fullmatch(word):
            continue

        w = norm(word)
        n = norm(normal_form)
        freq = zipf_frequency(word, "ru")

        if freq > allowed_freq.get(w, -1.0):
            allowed_freq[w] = freq

        if "sing" in tag and w == n and freq > singular_lemma_freq.get(w, -1.0):
            singular_lemma_freq[w] = freq

        grams = set(tag.grammemes)
        if "plur" in tag and "Pltm" in grams and freq > pltm_freq.get(w, -1.0):
            pltm_freq[w] = freq

    # Build answer candidates from real frequency-ranked words,
    # then validate morphology. This keeps answers more natural than
    # taking the full dictionary tail.
    freq_candidates: dict[str, tuple[int, float]] = {}
    for rank, word in enumerate(top_n_list("ru", 600000), start=1):
        if not RU_RE.fullmatch(word):
            continue
        if not morph.word_is_known(word):
            continue
        w = norm(word)
        if w in freq_candidates:
            continue

        best_score = 0.0
        for p in morph.parse(word):
            grams = set(p.tag.grammemes)
            if p.tag.POS != "NOUN":
                continue
            if "nomn" not in p.tag:
                continue
            if not ("sing" in p.tag or ("plur" in p.tag and "Pltm" in grams)):
                continue
            if norm(p.normal_form) != w:
                continue
            if BAD_NAME_TAGS & grams or BAD_STYLE_TAGS & grams:
                continue
            best_score = max(best_score, p.score)

        if best_score >= 0.20:
            freq_candidates[w] = (rank, best_score)

    answers = {
        w
        for w, (rank, score) in freq_candidates.items()
        if rank <= 600000 and score >= 0.21
    }

    # Manual quality patching.
    for w in MANUAL_ANSWER_ADDITIONS:
        wn = norm(w)
        if wn in singular_lemma_freq or (wn in pltm_freq and wn not in singular_lemma_freq):
            answers.add(wn)
    answers -= {norm(w) for w in MANUAL_ANSWER_EXCLUSIONS}

    # Safety net: if exclusions reduce too much, top up by frequency.
    if len(answers) < MIN_ANSWERS:
        exclusions = {norm(x) for x in MANUAL_ANSWER_EXCLUSIONS}
        backfill = sorted(
            (
                (rank, score, w)
                for w, (rank, score) in freq_candidates.items()
                if w not in answers and w not in exclusions
            ),
            key=lambda x: (x[0], -x[1], x[2]),
        )
        for _rank, _score, w in backfill:
            answers.add(w)
            if len(answers) >= MIN_ANSWERS:
                break

    if len(answers) < MIN_ANSWERS:
        raise RuntimeError(f"answers dictionary too small: {len(answers)} (need >3000)")

    allowed = set(allowed_freq.keys())
    # Keep excluded ambiguous words out of ALLOWED too.
    allowed -= {norm(w) for w in MANUAL_ANSWER_EXCLUSIONS}
    allowed |= answers

    if len(allowed) <= len(answers):
        raise RuntimeError(
            f"allowed dictionary must be wider than answers ({len(allowed)} <= {len(answers)})"
        )

    answers_upper = to_upper_sorted(answers)
    allowed_upper = to_upper_sorted(allowed)

    DICT_DIR.mkdir(parents=True, exist_ok=True)
    write_txt(DICT_DIR / f"answers_{WORD_LEN}.txt", answers_upper)
    write_txt(DICT_DIR / f"allowed_{WORD_LEN}.txt", allowed_upper)
    write_words_js(WORDS_JS, answers_upper, allowed_upper)

    print(f"answers_{WORD_LEN}.txt: {len(answers_upper)}")
    print(f"allowed_{WORD_LEN}.txt: {len(allowed_upper)}")


if __name__ == "__main__":
    main()
