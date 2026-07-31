"""
Ad-hoc script (not part of the deployed app) to check whether the chatbot's
intent classifier correctly resolves short follow-up messages against
conversation history, instead of misclassifying them as "unclear".

Setup (once): cp tests/.env.example tests/.env, fill in OLLAMA_API_KEY.

Run from anywhere, with backend/.venv activated:

    python tests/chat_context_followup.py
"""

import os
import sys

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(TESTS_DIR, "..", "backend"))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(TESTS_DIR, ".env"))
os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost/unused")

from app.services.chatbot import classify_intent  # noqa: E402

SCENARIOS = [
    {
        "name": "lowest-after-highest-humidity",
        "history": [
            ("user", "what was the highest humidity recorded"),
            ("assistant", "The highest humidity recorded was 81.33% at 4:40 UTC on July 12, 2026."),
        ],
        "message": "lowest",
        "expected": "data_question",
    },
    {
        "name": "bare-noun-metric-switch",
        "history": [
            ("user", "give me average temperature per day from july 10 to july 17"),
            ("assistant", "Day | Avg Temp (C) | Reading Count\n..."),
        ],
        "message": "avg humidity",
        "expected": "data_question",
    },
    {
        "name": "bare-noun-noise",
        "history": [
            ("user", "avg humidity"),
            ("assistant", "Day | Avg Humidity (%) | Reading Count\n..."),
        ],
        "message": "noise",
        "expected": "data_question",
    },
    {
        "name": "when-was-the-lowest-multi-turn-back",
        "history": [
            ("user", "give me highest temperature you have recorded"),
            ("assistant", "The highest recorded temperature is 29.38 C."),
            ("user", "when was that recording?"),
            ("assistant", "The recording took place at 5:10 pm UTC on July 27, 2026, with a temperature of 29.38 C."),
        ],
        "message": "when was the lowest?",
        "expected": "data_question",
    },
    {
        "name": "actual-greeting-still-small-talk",
        "history": [],
        "message": "hello",
        "expected": "small_talk",
    },
    {
        # Regression check: a plain, unambiguous first-turn data question
        # with no history at all. This should never fail -- if it does,
        # it's a sign the LLM call itself is erroring/truncating (e.g.
        # reasoning_effort too high for max_tokens) and silently falling
        # back to the keyword-only classifier, not a context-resolution
        # issue.
        "name": "unambiguous-first-turn-data-question",
        "history": [],
        "message": "give me highest temperature you have recorded",
        "expected": "data_question",
    },
]


def main() -> None:
    passed = 0
    for scenario in SCENARIOS:
        intent = classify_intent(scenario["message"], scenario["history"])
        ok = intent == scenario["expected"]
        passed += ok
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {scenario['name']}: message={scenario['message']!r} "
              f"-> got={intent!r} expected={scenario['expected']!r}")

    print(f"\n{passed}/{len(SCENARIOS)} passed")


if __name__ == "__main__":
    main()
