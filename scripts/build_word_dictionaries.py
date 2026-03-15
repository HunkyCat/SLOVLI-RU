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
ANSWERS_TARGET = 750
MIN_ANSWER_PARSE_SCORE = 0.30

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
    "бишоп",
    "боинг",
    "хонда",
    "унтер",
    "фюрер",
    "шаттл",
    "юнкер",
    "говно",
    "башка",
    "телек",
    "альба",
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

    # All nominative nouns (sing+plur) for ALLOWED fallback generation.
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

        parses = morph.parse(word)
        # If a token is also interpreted as proper-name classes,
        # keep it out of the answer pool to avoid ambiguous/tricky words.
        if any(BAD_NAME_TAGS & set(p.tag.grammemes) for p in parses):
            continue

        best_score = 0.0
        for p in parses:
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

        if best_score >= 0.21:
            freq_candidates[w] = (rank, best_score)

    exclusions = {norm(w) for w in MANUAL_ANSWER_EXCLUSIONS}
    ranked_answers = sorted(
        (
            (rank, score, w)
            for w, (rank, score) in freq_candidates.items()
            if score >= MIN_ANSWER_PARSE_SCORE and w not in exclusions
        ),
        key=lambda x: (x[0], -x[1], x[2]),
    )
    if len(ranked_answers) < ANSWERS_TARGET:
        raise RuntimeError(
            f"not enough answer candidates: {len(ranked_answers)} < {ANSWERS_TARGET}"
        )
    answers = {w for _rank, _score, w in ranked_answers[:ANSWERS_TARGET]}

    # Keep existing allowed dictionary unchanged if it already exists.
    allowed_path = DICT_DIR / f"allowed_{WORD_LEN}.txt"
    if allowed_path.exists():
        allowed_upper = [
            line.strip().upper()
            for line in allowed_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    else:
        allowed = set(allowed_freq.keys())
        allowed -= exclusions
        allowed |= answers
        allowed_upper = to_upper_sorted(allowed)

    answers_upper = to_upper_sorted(answers)

    if len(answers_upper) != ANSWERS_TARGET:
        raise RuntimeError(
            f"answers dictionary size mismatch: {len(answers_upper)} != {ANSWERS_TARGET}"
        )
    if len(set(allowed_upper)) <= len(answers_upper):
        raise RuntimeError(
            f"allowed dictionary must be wider than answers ({len(set(allowed_upper))} <= {len(answers_upper)})"
        )

    DICT_DIR.mkdir(parents=True, exist_ok=True)
    write_txt(DICT_DIR / f"answers_{WORD_LEN}.txt", answers_upper)
    # Preserve allowed file if it exists; otherwise create it.
    if not allowed_path.exists():
        write_txt(allowed_path, allowed_upper)
    write_words_js(WORDS_JS, answers_upper, allowed_upper)

    print(f"answers_{WORD_LEN}.txt: {len(answers_upper)}")
    print(f"allowed_{WORD_LEN}.txt: {len(allowed_upper)}")


if __name__ == "__main__":
    main()
